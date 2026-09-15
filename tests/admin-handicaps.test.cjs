const test=require('node:test');
const assert=require('node:assert/strict');
const {parseHandicap,sortedMembers}=require('../assets/js/admin-handicaps.js');
test('admin handicap accepts zero and decimals but never treats missing input as zero',()=>{
 for(const [value,expected] of [['0',0],['18.5',18.5],['54',54],[' 12 ',12]])assert.equal(parseHandicap(value),expected);
 for(const value of ['',null,undefined,'NaN','Infinity','-1','54.1','18.55','0x10','1e1'])assert.throws(()=>parseHandicap(value));
});
test('members without handicaps sort first, with zero kept as an assigned handicap',()=>{
 const rows=[{id:'1',full_name:'Adam',handicap:0},{id:'2',full_name:'Zoe',handicap:null},{id:'3',full_name:'Ben',handicap:null}];
 assert.deepEqual(sortedMembers(rows).map(p=>p.id),['3','2','1']);assert.equal(rows[0].id,'1');
});
