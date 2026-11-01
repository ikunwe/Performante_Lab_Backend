const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createApp}=require('../src/app');
const A='11111111-1111-4111-8111-111111111111',U='22222222-2222-4222-8222-222222222222',I='33333333-3333-4333-8333-333333333333';
async function setup(t){
  const row=(is_public,is_deleted=false)=>({id:randomUUID(),user_id:U,title:'Database Build',car_name:'Civic',tag:'recorded',parts:[],image_url:'https://test/real-car.png',budget:0,likes:3,category:'Street',is_public,is_deleted,created_at:new Date().toISOString()});
  const rows=[row(true),row(false),row(true,true)],profiles=[{id:A,role:'Admin',status:'Active',username:'Admin'},{id:U,role:'User',status:'Active',username:'Driver'},{id:I,role:'Admin',status:'InActive',username:'Suspended'}];let failed=false;
  class Query{
    constructor(table){this.table=table;this.filters=[];}
    select(){return this;}
    eq(key,value){this.filters.push(row=>row[key]===value);return this;}
    in(key,values){this.filters.push(row=>values.includes(row[key]));return this;}
    order(){return this;}
    update(value){this.value=value;return this;}
    result(single=false){
      if(failed && this.table==='builds')return {data:null,error:{message:'private-details'}};
      let data=(this.table==='builds'?rows:profiles).filter(row=>this.filters.every(filter=>filter(row)));
      if(this.value)data.forEach(row=>Object.assign(row,this.value));
      if(this.window)data=data.slice(this.window[0],this.window[1]+1);
      return {data:single?data[0]||null:data,error:null};
    }
    maybeSingle(){return Promise.resolve(this.result(true));}
    range(start,end){this.window=[start,end];return Promise.resolve(this.result());}
    then(resolve,reject){return Promise.resolve(this.result()).then(resolve,reject);}
  }
  const ids={admin:A,user:U,inactive:I},admin={from:table=>new Query(table)};
  const supabase={auth:{getUser:async token=>ids[token]?{data:{user:{id:ids[token]}},error:null}:{data:null,error:{status:401}}}};
  const server=await new Promise(resolve=>{const s=createApp({admin,supabase}).listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port+'/api/admin/builds';
  return {rows,fail:()=>{failed=true;},call:(path='',token='admin',method='GET')=>fetch(base+path,{method,headers:token?{Authorization:'Bearer '+token}:{}})};
}
test('Admin Discover reads real public/private builds and never substitutes examples',async t=>{
  const {rows,call}=await setup(t);const response=await call();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const data=await response.json();assert.deepEqual(data.builds.map(b=>b.id),rows.slice(0,2).map(b=>b.id));
  assert.equal(data.builds[0].author,'Driver');assert.equal(data.builds[0].image,'https://test/real-car.png');assert.equal(data.builds[1].isPublic,false);assert.equal(data.builds[0].likes,3);
  rows.splice(0);assert.deepEqual((await (await call()).json()).builds,[]);
});
test('Admin build APIs reject User/anonymous/suspended accounts and soft-delete only after authorization',async t=>{
  const {rows,call}=await setup(t);
  for(const [token,status] of [[null,401],['user',403],['inactive',403]])assert.equal((await call('',token)).status,status);
  const id=rows[0].id;assert.equal((await call('/'+id,'user','DELETE')).status,403);assert.equal(rows[0].is_deleted,false);
  assert.equal((await call('/'+id,'admin','DELETE')).status,204);assert.equal(rows[0].is_deleted,true);
  assert.equal((await call('/'+id,'admin','DELETE')).status,204);
  assert.equal((await call('/invalid','admin','DELETE')).status,400);
});
test('Admin Discover reports outages and supports bounded pagination',async t=>{
  const {rows,call,fail}=await setup(t);const sample=rows[0];rows.splice(0,rows.length,...Array.from({length:101},()=>({...sample,id:randomUUID()})));
  assert.equal((await (await call()).json()).nextOffset,100);assert.equal((await (await call('?offset=100')).json()).builds.length,1);
  assert.equal((await call('?offset=-1')).status,400);fail();const response=await call();assert.equal(response.status,503);assert.ok(!(await response.text()).includes('private-details'));
});
