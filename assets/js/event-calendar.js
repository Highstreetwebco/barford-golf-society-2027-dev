const clean = value => String(value || '').replace(/[\r\n]+/g,' ').trim();
const icsText = value => String(value || '').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
const stamp = date => date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
function times(event) {
  const date = event.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('The event date is unavailable.');
  const midnight = new Date(date + 'T00:00:00Z');
  const tee = String(event.tee_time || '').slice(0,5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(tee)) return {allDay:true,start:date.replaceAll('-',''),end:new Date(+midnight+86400000).toISOString().slice(0,10).replaceAll('-','')};
  const wall = Date.parse(date + 'T' + tee + ':00Z');
  let utc = wall;
  const formatter = new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  for(let i=0;i<3;i++) {
    const p = Object.fromEntries(formatter.formatToParts(new Date(utc)).map(x=>[x.type,x.value]));
    const shown = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
    utc += wall-shown;
  }
  const hours = Number(event.round_hours);
  return {allDay:false,start:stamp(new Date(utc)),end:stamp(new Date(utc+(Number.isFinite(hours)&&hours>=1&&hours<=12?hours:5)*3600000))};
}
function description(event,allDay) {
  return `Guest RSVP for ${clean(event.event_name)}. Invited by ${clean(event.host_name)}. ${allDay?'Your individual tee time is not published yet. Confirm it with your inviting member before travelling.':'Your tee time is '+clean(event.tee_time)+', UK time.'} Return to your private invitation message to manage your RSVP. Online changes close 10 days before the event.`;
}
export function calendarLinks(event) {
  const t=times(event), title=clean(event.event_name), location=clean(event.address||event.location), details=description(event,t.allDay);
  const google=new URL('https://calendar.google.com/calendar/render');
  for(const [k,v] of Object.entries({action:'TEMPLATE',text:title,dates:t.start+'/'+t.end,ctz:'Europe/London',details,location})) google.searchParams.set(k,v);
  const outlook=new URL('https://outlook.live.com/calendar/0/deeplink/compose');
  const iso=s=>t.allDay?`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`:`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(9,11)}:${s.slice(11,13)}:${s.slice(13,15)}Z`;
  for(const [k,v] of Object.entries({path:'/calendar/action/compose',rru:'addevent',subject:title,startdt:iso(t.start),enddt:iso(t.end),allday:String(t.allDay),body:details,location})) outlook.searchParams.set(k,v);
  return {google:google.href,outlook:outlook.href,allDay:t.allDay};
}
export function calendarICS(event,now=new Date()) {
  const t=times(event);
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Barford Golf Society//Guest RSVP//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',`UID:barford-event-${Number(event.event_id)}@barfordgolf.co.uk`,`DTSTAMP:${stamp(now)}`,`DTSTART${t.allDay?';VALUE=DATE':''}:${t.start}`,`DTEND${t.allDay?';VALUE=DATE':''}:${t.end}`,`SUMMARY:${icsText(event.event_name)}`,`LOCATION:${icsText(event.address||event.location)}`,`DESCRIPTION:${icsText(description(event,t.allDay))}`,'STATUS:CONFIRMED','END:VEVENT','END:VCALENDAR'];
  // RFC 5545 folds by UTF-8 octets, without breaking a multibyte character.
  const encoder=new TextEncoder();
  return lines.map(line=>{let result='',size=0;for(const char of line){const n=encoder.encode(char).length;if(size+n>74){result+='\r\n ';size=1;}result+=char;size+=n;}return result;}).join('\r\n')+'\r\n';
}
