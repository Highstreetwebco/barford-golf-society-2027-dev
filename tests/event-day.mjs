import assert from 'node:assert/strict';
import { test } from 'node:test';
import { navigationLinks } from '../assets/js/event-directions.js';
import { nearestForecast } from '../assets/js/event-weather.js';
import { eventWeather, weatherLocation, weatherLocationKey } from '../supabase/functions/baseline-services/event-weather.ts';

const event = { id: 110, date: '2027-04-30', address: 'Crewe Lane, Kenilworth, Warwickshire CV8 2EA' };
const now = new Date('2027-04-29T11:00:00Z');
const hours = [9,10,11,12].map(hour => ({ time: `2027-04-30T${String(hour).padStart(2,'0')}:00`, temperature: hour, rain: 0, wind: 16.09344, code: 2 }));
const forecast = { status: 'ready', event_date: event.date, timezone: 'Europe/London', location_key: weatherLocationKey(event), hours };
function services({ saved = [], allow = true, fail = false } = {}) {
  const calls = [], writes = [];
  return { calls, writes, now,
    db: async (path,method,body) => { if(method==='POST')writes.push({path,body});return saved; },
    budget: async (...args) => { calls.push(args); return allow; },
    place: async () => { throw new Error('Place unavailable'); },
    get: async url => {
      calls.push(url);if(fail)throw new Error('Provider offline');
      if(url.startsWith('https://api.postcodes.io/postcodes/'))return {status:200,result:{latitude:52.35,longitude:-1.55}};
      const p=new URL(url).searchParams;
      assert.equal(p.get('timezone'),'Europe/London');assert.equal(p.get('wind_speed_unit'),'kmh');
      return {hourly:{time:hours.map(h=>h.time),temperature_2m:hours.map(h=>h.temperature),precipitation_probability:[0,null,20,30],weather_code:[2,null,3,61],wind_speed_10m:[0,null,16,20]}};
    },
  };
}

test('All map apps receive the saved address, safely encoded, ahead of a stale pin', () => {
  const address='Golf & Spa, Lane #2, Kenilworth CV8 2EA';
  const result=navigationLinks({...event,address,latitude:0,longitude:0});
  assert.equal(result.destination,address);
  for(const link of result.links){const u=new URL(link.url);assert.equal(u.protocol,'https:');assert.equal(u.searchParams.get(link.name==='Waze'?'q':'destination'),address);assert.equal(u.hash,'');}
  assert.equal(new URL(result.links[0].url).searchParams.get('dir_action'),'navigate');
  assert.equal(new URL(result.links[1].url).searchParams.get('navigate'),'yes');
  assert.equal(new URL(result.links[2].url).searchParams.get('mode'),'driving');
  assert.equal(navigationLinks({name:'Ambiguous club'}).links.length,0,'Do not guess a destination from a club name');
  assert.equal(navigationLinks({latitude:0,longitude:-1}).destination,'0,-1');
  assert.equal(navigationLinks({latitude:91,longitude:0}).links.length,0);
});

test('Personal hourly forecast uses UK wall time, nearest hour, and exact event day', () => {
  assert.equal(nearestForecast(forecast,event.date,'10:16').temperature,10);
  assert.equal(nearestForecast(forecast,event.date,'10:40').temperature,11);
  assert.equal(nearestForecast(forecast,event.date,'10:30:00').temperature,10);
  for(const time of [null,'24:00','10:72','03:00'])assert.equal(nearestForecast(forecast,event.date,time),null);
  assert.equal(nearestForecast({...forecast,event_date:'2027-05-01'},event.date,'10:16'),null);
  assert.equal(nearestForecast({...forecast,timezone:'UTC'},event.date,'10:16'),null);
  assert.equal(nearestForecast({...forecast,hours:[{time:'2027-05-01T10:00'}]},event.date,'10:16'),null);
});

test('Saved UK address supplies weather coordinates when the map pin is missing', async () => {
  const s=services();const result=await eventWeather(event,s);
  assert.equal(result.status,'ready');assert.equal(result.event_date,event.date);
  assert(s.calls.includes('https://api.postcodes.io/postcodes/CV82EA'));
  assert.equal(s.writes.length,1);assert.equal(result.hours[0].temperature,9);
  assert.equal(result.hours[0].rain,0);assert.equal(result.hours[1].rain,null,'Missing data must not become zero');
  assert.equal(result.hours[1].code,null,'Missing weather code must not become clear skies');
  const point=await weatherLocation({...event,place_id:'unavailable-place'},s);
  assert.deepEqual(point,{latitude:52.35,longitude:-1.55});
});

test('Valid coordinates avoid a lookup, including zero latitude', async () => {
  const s=services();assert.deepEqual(await weatherLocation({latitude:0,longitude:-1},s),{latitude:0,longitude:-1});
  assert.equal(s.calls.length,0);
  assert.equal(await weatherLocation({address:'An unlocated golf course'},s),null);
  assert.equal(await weatherLocation(event,{get:async()=>({status:200,result:{latitude:null,longitude:null}}),place:s.place}),null);
});

test('The forecast window uses the UK calendar and never requests distant or finished events', async () => {
  for(const date of ['2027-04-28','2027-05-15']){
    const s=services();const result=await eventWeather({...event,date},s);
    assert.equal(result.status,date<'2027-04-29'?'closed':'too_early');assert.equal(s.calls.length,0);
  }
  const s=services();assert.equal((await eventWeather({...event,cancelled:true},s)).status,'closed');
  const midnight=services();midnight.now=new Date('2027-04-29T23:30:00Z');
  assert.equal((await eventWeather({...event,date:'2027-04-29'},midnight)).status,'closed','BST is already on the next day');
});

test('Forecast cache follows event date and address, with bounded stale fallback', async () => {
  const saved=[{forecast,updated_at:'2027-04-29T10:00:00Z'}];
  const fresh=services({saved});assert.equal((await eventWeather(event,fresh)).status,'ready');assert.equal(fresh.calls.length,0);
  const moved=services({saved});await eventWeather({...event,address:'Other course CV8 3DR'},moved);
  assert(moved.calls.includes('https://api.postcodes.io/postcodes/CV83DR'));
  const rescheduled=services({saved,fail:true});assert.equal((await eventWeather({...event,date:'2027-05-01'},rescheduled)).status,'unavailable');
  const older=[{forecast,updated_at:'2027-04-29T05:00:00Z'}];
  assert.equal((await eventWeather(event,services({saved:older,fail:true}))).stale,true);
  assert.equal((await eventWeather(event,services({saved:older,allow:false}))).stale,true);
  assert.equal((await eventWeather(event,services({saved:[{forecast,updated_at:'2027-04-27T05:00:00Z'}],fail:true}))).status,'unavailable');
  assert.equal((await eventWeather({...event,address:'Moved CV8 3DR'},services({saved:older,allow:false}))).status,'unavailable','Never reuse weather from another venue');
});

test('A missing map and postcode reports unavailable location without guessing', async () => {
  const s=services();assert.equal((await eventWeather({...event,address:''},s)).status,'no_location');assert.equal(s.writes.length,0);
});
