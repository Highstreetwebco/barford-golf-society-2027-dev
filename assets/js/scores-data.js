/**
 * Empty 2027 scores adapter.
 *
 * The previous local demonstration season has been removed. This adapter
 * deliberately returns a clean season until the Supabase data adapter is
 * enabled after the first real administrator account is created.
 */
export const DATABASE_ADAPTER = Object.freeze({
  driver: "supabase",
  project: "xspzmthygrajzktydvvj",
  season: 2027
});

const emptySeason = () => ({
  season: 2027,
  players: [],
  rounds: [],
  achievements: [],
  nextEvent: null
});

let snapshot = emptySeason();
let loadedAt = 0, owner = null, revision = 0, pending = null;
const clone = value => JSON.parse(JSON.stringify(value));
const changed = () => window.dispatchEvent(new CustomEvent("scores:data-changed"));

export const ScoresData = {
  async getSnapshot(userId) {
    const client=window.BarfordSupabase,flow=window.BarfordMemberFlow;
    if(!client)throw new Error("Results connection unavailable");
    if(!userId)throw new Error("Sign in to view results");
    if(owner!==userId){owner=userId;revision++;snapshot=emptySeason();loadedAt=0;pending=null;}
    if(Date.now()-loadedAt<30000)return clone(snapshot);
    if(pending)return clone(await pending);
    const version=++revision;
    const operation=(async()=>{
      const [snapshotResult,eventResult]=await flow.bounded(Promise.all([
        client.rpc("get_2027_leaderboard_snapshot"),
        client.from("events").select("id,name,venue,address,event_date,first_tee_time,price")
          .eq("status","scheduled").gte("event_date",flow.today()).order("event_date").limit(1)
      ]));
      if(snapshotResult.error)throw snapshotResult.error;
      if(!snapshotResult.data)throw new Error("Results could not be loaded");
      if(owner!==userId||revision!==version)throw new Error("Your account changed. Please refresh results.");
      const rawPlayers=snapshotResult.data.players||[];
      snapshot={...emptySeason(),...snapshotResult.data,
        players:rawPlayers.map(player=>({...player,photoUrl:null})),
        nextEvent:eventResult.error?null:eventResult.data?.[0]||null};
      loadedAt=Date.now();
      const paths=[...new Set(rawPlayers.map(player=>player.photoUrl).filter(Boolean))];
      if(paths.length) {
        // One authorised batch runs in the background; initials remain if it fails.
        flow.request(client.storage.from("profile-images").createSignedUrls(paths,3600)).then(rows=>{
          if(owner!==userId||revision!==version)return;
          const urls=new Map((rows||[]).filter(row=>!row.error&&row.signedUrl).map(row=>[row.path,row.signedUrl]));
          const photos=rawPlayers.map(player=>({id:player.id,url:urls.get(player.photoUrl)||null}));
          const byId=new Map(photos.map(photo=>[photo.id,photo.url]));
          snapshot.players=snapshot.players.map(player=>({...player,photoUrl:byId.get(player.id)||null}));
          window.dispatchEvent(new CustomEvent("scores:photos-ready",{detail:{userId,photos}}));
        }).catch(()=>{});
      }
      return snapshot;
    })();
    pending=operation;
    try{return clone(await operation);}finally{if(pending===operation)pending=null;}
  },
  async saveSnapshot(next) { snapshot = clone(next); changed(); return clone(snapshot); },
  async reset() { revision++;owner=null;loadedAt=0;pending=null;snapshot = emptySeason(); changed(); return clone(snapshot); },
  async addPlayer() { throw new Error("Use the secure 2027 member system to add players."); },
  async updatePlayer() { throw new Error("Secure score administration is not active yet."); },
  async removePlayer() { throw new Error("Secure score administration is not active yet."); },
  async createRound() { throw new Error("Secure score administration is not active yet."); },
  async saveRoundResults() { throw new Error("Secure score administration is not active yet."); },
  async addAchievement() { throw new Error("Secure score administration is not active yet."); },
  async removeAchievement() { throw new Error("Secure score administration is not active yet."); }
};
