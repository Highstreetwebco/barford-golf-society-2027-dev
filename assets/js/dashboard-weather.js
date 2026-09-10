(() => {
  "use strict";
  const client = window.BarfordSupabase;
  if (!client) return;
  const initialise=async model=>{
  const host=document.getElementById("dashboardEventFacts");if(!host||!model)return;
  document.getElementById("dashboardWeather")?.remove();
  const localDate = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const friendlyDate = value => new Intl.DateTimeFormat("en-GB",{weekday:"short",day:"numeric",month:"short"}).format(new Date(value+"T12:00:00"));
  const card = document.createElement("section");
  card.id = "dashboardWeather";
  card.className = "dashboard-weather-card hidden";
  card.setAttribute("aria-live","polite");
  card.innerHTML = '<span aria-hidden="true">⛅</span><div><small>Weather for your round</small><strong>Checking the course forecast…</strong><p class="dashboard-weather-summary"></p><small class="dashboard-weather-change"></small><small class="dashboard-weather-tips"></small></div>';
  host.after(card);
  const set = (title, detail, change="", tips="") => {
    card.querySelector("strong").textContent=title;
    card.querySelector(".dashboard-weather-summary").textContent=detail;
    card.querySelector(".dashboard-weather-change").textContent=change;
    card.querySelector(".dashboard-weather-tips").textContent=tips;
    card.classList.remove("hidden");
  };
  const adviceFor = ({temp,rain,wind}) => {
    const tips=[];
    if(rain>=30) tips.push("Bring a waterproof jacket.");
    if(temp>=20) tips.push("Bring sun cream and plenty to drink.");
    if(temp<=10) tips.push("Bring an extra warm layer.");
    if(wind>=18) tips.push("Expect gusts — keep a layer handy.");
    if(!tips.length) tips.push("Comfortable conditions — take water as usual.");
    return "Golf-day tips: "+tips.join(" ");
  };
  const condition = code => code === 0 ? ["☀️","Sunny"] : [1,2].includes(code) ? ["🌤️","Sunny intervals"] : code === 3 ? ["☁️","Cloudy"] : [45,48].includes(code) ? ["🌫️","Foggy"] : [51,53,55].includes(code) ? ["🌦️","Drizzle"] : [61,63,65,80,81,82].includes(code) ? ["🌧️","Rain"] : [95,96,99].includes(code) ? ["⛈️","Thunderstorms"] : ["🌥️","Mixed conditions"];
    const {event,session}=model;
    if (!event?.event_date || event.latitude == null || event.longitude == null) return;
    const days = Math.ceil((new Date(event.event_date+"T12:00:00") - new Date()) / 86400000);
    if (days < 0) return;
    if (days >= 16) { set("Forecast will appear nearer the day", friendlyDate(event.event_date)+" · reliable tee-time weather is normally available within 16 days."); return; }
    try {
      const memberTee=model.group?.find(p=>p.is_you);
      const teeTime=String(memberTee?.tee_time||event.first_tee_time||"09:00").slice(0,5);
      const params = new URLSearchParams({latitude:event.latitude,longitude:event.longitude,hourly:"temperature_2m,precipitation_probability,weather_code,wind_speed_10m",temperature_unit:"celsius",wind_speed_unit:"mph",timezone:"Europe/London",start_date:event.event_date,end_date:event.event_date,models:"best_match"});
      const response = await fetch("https://api.open-meteo.com/v1/forecast?"+params,{cache:"no-store"});
      if (!response.ok) throw Error();
      const weather=await response.json();
      const target=new Date(`${event.event_date}T${teeTime}:00`).getTime();
      let index=0,closest=Infinity;
      weather.hourly.time.forEach((time,i)=>{const distance=Math.abs(new Date(time).getTime()-target);if(distance<closest){closest=distance;index=i;}});
      const [weatherIcon,label]=condition(weather.hourly.weather_code[index]);
      const temp=Math.round(weather.hourly.temperature_2m[index]);
      const rain=Math.round(weather.hourly.precipitation_probability[index]||0);
      const wind=Math.round(weather.hourly.wind_speed_10m[index]||0);
      const roundIndexes=weather.hourly.time.map((time,i)=>({time,i})).filter(({time})=>{
        const hour=new Date(time).getTime();
        return hour>=target&&hour<=target+(4*60*60*1000);
      }).map(({i})=>i);
      const forecastIndexes=roundIndexes.length?roundIndexes:[index];
      const roundRain=Math.max(...forecastIndexes.map(i=>Math.round(weather.hourly.precipitation_probability[i]||0)));
      const roundWind=Math.max(...forecastIndexes.map(i=>Math.round(weather.hourly.wind_speed_10m[i]||0)));
      const roundTemps=forecastIndexes.map(i=>Math.round(weather.hourly.temperature_2m[i]));
      const tempShift=Math.max(...roundTemps)-Math.min(...roundTemps);
      const codeChanges=forecastIndexes.some(i=>weather.hourly.weather_code[i]!==weather.hourly.weather_code[index]);
      const moreRain=roundRain>=rain+20;
      const windShift=roundWind>=wind+8;
      const endTime=String(weather.hourly.time[forecastIndexes.at(-1)]||"").slice(11,16);
      const change=(moreRain||windShift||codeChanges||tempShift>=4)
        ? `During your round: forecast to change — rain chance reaches ${roundRain}% by about ${endTime||"the end"}.`
        : `During your round: forecast looks steady — rain chance stays around ${roundRain}%.`;
      card.querySelector("span").textContent=weatherIcon;
      set(`${temp}°C · ${label}`, `${teeTime} tee-off at ${event.venue||event.name} · ${rain}% chance of rain · up to ${roundRain}% during your round · ${wind} mph wind`, change, adviceFor({temp:Math.max(temp,...roundTemps),rain:roundRain,wind:roundWind}));
    } catch { set("Weather update unavailable", "We will try again automatically when you revisit the dashboard."); }
  };
  window.addEventListener("barford-dashboard-ready",e=>initialise(e.detail));
  if(window.BarfordDashboardModel)initialise(window.BarfordDashboardModel);
})();
