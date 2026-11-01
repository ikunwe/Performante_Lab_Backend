const {Router}=require('express');
const {createStorageCatalog}=require('../services/storage-catalog');
const {showcaseBuilds,showcaseColumns}=require('../services/showcase-builds');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function unavailable(res){return res.status(503).json({error:'ADMIN_BUILDS_UNAVAILABLE',message:'โหลดหรือจัดการ Build ไม่สำเร็จ กรุณาลองใหม่'});}
// Mounted behind the application's /api/admin Auth + Active Admin/SuperAdmin guard.
function adminBuildsRoutes({admin}) {
  const router=Router(),storage=createStorageCatalog({admin});
  router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
  router.get('/',async(req,res)=>{
    const offset=req.query.offset===undefined?0:Number(req.query.offset);
    if(!Number.isInteger(offset)||offset<0||offset>10000)return res.status(400).json({error:'INVALID_PAGE'});
    try{
      const {data,error}=await admin.from('builds').select(showcaseColumns).eq('is_deleted',false)
        .order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+99);
      if(error||!Array.isArray(data))return unavailable(res);
      return res.json({builds:await showcaseBuilds(admin,storage,data,req.authUser.id),nextOffset:data.length===100&&offset+100<=10000?offset+100:null});
    }catch{return unavailable(res);}
  });
  router.delete('/:id',async(req,res)=>{
    if(!UUID.test(req.params.id))return res.status(400).json({error:'INVALID_BUILD'});
    try{
      const {data,error}=await admin.from('builds').update({is_deleted:true,updated_at:new Date().toISOString()}).eq('id',req.params.id).select('id').maybeSingle();
      if(error)return unavailable(res);
      if(!data)return res.status(404).json({error:'BUILD_NOT_FOUND',message:'ไม่พบ Build นี้'});
      return res.status(204).end();
    }catch{return unavailable(res);}
  });
  return router;
}
module.exports={adminBuildsRoutes};
