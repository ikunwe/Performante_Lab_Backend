// Opt-in cloud check; creates and deletes only its temporary accounts/builds.
require('dotenv').config({quiet:true});
const assert=require('node:assert/strict');
const {randomUUID,randomBytes}=require('node:crypto');
const {createAdmin,createSupabase}=require('../src/config/supabase');
const {createApp}=require('../src/app');
async function main(){
  const admin=createAdmin(process.env),supabase=createSupabase(process.env);assert.ok(admin&&supabase,'Supabase configuration required');
  const nonce=randomBytes(6).toString('hex'),accounts=[],ids=[randomUUID(),randomUUID()];let server;
  try{
    for(const role of ['User','Admin']){
      const password=randomBytes(32).toString('base64url');
      const created=await admin.auth.admin.createUser({email:`admin-build-smoke-${role.toLowerCase()}-${nonce}@example.com`,password,email_confirm:true});assert.ifError(created.error);
      const user=created.data.user;assert.ok(user?.id);accounts.push({id:user.id});
      assert.ifError((await admin.from('profiles').upsert({id:user.id,username:`adminbuild_${role}_${nonce}`,role,status:'Active'})).error);
      const login=await createSupabase(process.env).auth.signInWithPassword({email:user.email,password});assert.ifError(login.error);accounts.at(-1).token=login.data.session.access_token;
    }
    assert.ifError((await admin.from('builds').insert(ids.map((id,index)=>({id,user_id:accounts[0].id,title:'Temporary Admin Build check '+index,car_name:'Temporary car',tag:'smoke-recorded-car',image_url:'',parts:[],is_public:index===0,is_deleted:false})))).error);
    server=await new Promise(resolve=>{const s=createApp({admin,supabase}).listen(0,'127.0.0.1',()=>resolve(s));});
    const base='http://127.0.0.1:'+server.address().port+'/api/admin/builds';
    const call=(path='',method='GET',account=accounts[1])=>fetch(base+path,{method,headers:{Authorization:'Bearer '+account.token}});
    assert.equal((await call('','GET',accounts[0])).status,403);
    let response=await call();assert.equal(response.status,200,await response.clone().text());
    const list=(await response.json()).builds;assert.ok(ids.every(id=>list.some(row=>row.id===id)));
    assert.equal(list.find(row=>row.id===ids[1]).isPublic,false);assert.equal(list.find(row=>row.id===ids[0]).image,'');
    assert.equal((await call('/'+ids[1],'DELETE',accounts[0])).status,403);
    assert.equal((await call('/'+ids[1],'DELETE')).status,204);
    const record=await admin.from('builds').select('is_deleted').eq('id',ids[1]).eq('user_id',accounts[0].id).single();assert.ifError(record.error);assert.equal(record.data.is_deleted,true);
    response=await call();assert.equal(response.status,200);assert.ok(!(await response.json()).builds.some(row=>row.id===ids[1]));
    console.log('PASS: Admin real public/private Build reads, User denial, canonical DTO and backend soft deletion');
  }finally{
    const errors=[];
    if(accounts[0]){const result=await admin.from('builds').delete().in('id',ids).eq('user_id',accounts[0].id);if(result.error)errors.push('delete temporary builds');}
    for(const account of accounts){const result=await admin.auth.admin.deleteUser(account.id);if(result.error)errors.push('delete temporary account');}
    if(server)await new Promise(resolve=>server.close(resolve));assert.deepEqual(errors,[],'Temporary-data cleanup failed');
    console.log('Temporary accounts and Builds cleaned.');
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
