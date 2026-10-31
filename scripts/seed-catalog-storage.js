const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
const BUCKET = 'catalog';

const FRONTEND_ASSETS = path.join(__dirname, '../../Performante_Lab_Frontend/assets');

// Helper to read local file buffer
function getAsset(relativePath) {
  const fullPath = path.join(FRONTEND_ASSETS, relativePath);
  if (fs.existsSync(fullPath)) {
    return fs.readFileSync(fullPath);
  }
  return null;
}

// Minimal 1x1 transparent PNG or SVG fallback buffer if file doesn't exist
function createFallbackBuffer(text) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
    <rect width="100%" height="100%" fill="#1a1a24"/>
    <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#f59e0b" font-family="sans-serif" font-size="20" font-weight="bold">${text}</text>
  </svg>`;
  return Buffer.from(svg, 'utf-8');
}

async function uploadFile(storagePath, buffer, contentType) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType,
      upsert: true,
    });

  if (error) {
    console.error(`❌ Failed: ${storagePath}`, error.message);
  } else {
    console.log(`✅ Uploaded: ${storagePath}`);
  }
}

async function main() {
  console.log('🚀 Step 1: Updating Bucket Size Limit & Allowed MIME Types...');
  const { data: updateRes, error: updateErr } = await supabase.storage.updateBucket(BUCKET, {
    public: true,
    fileSizeLimit: 52428800, // 50MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'],
  });
  if (updateErr) {
    console.warn('Bucket update warning:', updateErr);
  } else {
    console.log('Bucket limit updated to 50MB with SVG support');
  }

  console.log('\n📦 Step 2: Seeding Catalog Storage Tree from STORAGE_CATALOG_TREE.md...');

  const ferrariLogo = getAsset('brands/ferrari.png');
  const toyotaLogo = getAsset('brands/toyota.svg');
  const lamborghiniLogo = getAsset('brands/lamborghini.png');
  const hondaLogo = getAsset('brands/honda.svg');
  const carPic1 = getAsset('car_pic.png');
  const carPic2 = getAsset('car_pic_loginpage.jpg');
  const labLogo = getAsset('Logo_Performante_Lab.png');

  // Define files exactly matching STORAGE_CATALOG_TREE.md
  const filesToUpload = [
    // --- Ferrari ---
    { path: 'Ferrari/logo.png', buffer: ferrariLogo, mime: 'image/png' },
    // 488 Pista
    { path: 'Ferrari/488-Pista/CarPicture.jpg', buffer: carPic1, mime: 'image/png' },
    // 488 Pista -> BodyKit -> Sano-Design
    { path: 'Ferrari/488-Pista/BodyKit/Sano-Design/logo.png', buffer: labLogo, mime: 'image/png' },
    { path: 'Ferrari/488-Pista/BodyKit/Sano-Design/Track-Edition.png', buffer: createFallbackBuffer('Sano Track Edition'), mime: 'image/svg+xml' },
    { path: 'Ferrari/488-Pista/BodyKit/Sano-Design/Street-Aero.png', buffer: createFallbackBuffer('Sano Street Aero'), mime: 'image/svg+xml' },
    // 488 Pista -> BodyKit -> Novitec
    { path: 'Ferrari/488-Pista/BodyKit/Novitec/logo.png', buffer: labLogo, mime: 'image/png' },
    { path: 'Ferrari/488-Pista/BodyKit/Novitec/N-Largo-Widebody.png', buffer: createFallbackBuffer('Novitec N-Largo Widebody'), mime: 'image/svg+xml' },
    { path: 'Ferrari/488-Pista/BodyKit/Novitec/Carbon-Lip-Kit.png', buffer: createFallbackBuffer('Novitec Carbon Lip Kit'), mime: 'image/svg+xml' },
    // 488 Pista -> Part -> Brembo
    { path: 'Ferrari/488-Pista/Part/Brembo/logo.png', buffer: labLogo, mime: 'image/png' },
    { path: 'Ferrari/488-Pista/Part/Brembo/GT-R-Brake-Kit.png', buffer: createFallbackBuffer('Brembo GT-R Brake Kit'), mime: 'image/svg+xml' },
    { path: 'Ferrari/488-Pista/Part/Brembo/Carbon-Ceramic-Rotors.png', buffer: createFallbackBuffer('Brembo Carbon Ceramic Rotors'), mime: 'image/svg+xml' },
    // 488 Pista -> Part -> Capristo
    { path: 'Ferrari/488-Pista/Part/Capristo/logo.png', buffer: labLogo, mime: 'image/png' },
    { path: 'Ferrari/488-Pista/Part/Capristo/Valved-Exhaust-System.jpg', buffer: createFallbackBuffer('Capristo Valved Exhaust'), mime: 'image/svg+xml' },
    { path: 'Ferrari/488-Pista/Part/Capristo/Carbon-Rear-Diffuser.png', buffer: createFallbackBuffer('Capristo Carbon Rear Diffuser'), mime: 'image/svg+xml' },

    // 458 Italia
    { path: 'Ferrari/458-Italia/CarPicture.jpg', buffer: carPic1, mime: 'image/png' },
    // 458 Italia -> BodyKit -> Liberty-Walk
    { path: 'Ferrari/458-Italia/BodyKit/Liberty-Walk/logo.png', buffer: labLogo, mime: 'image/png' },
    { path: 'Ferrari/458-Italia/BodyKit/Liberty-Walk/LB-Silhouette-Works.png', buffer: createFallbackBuffer('LB Silhouette Works'), mime: 'image/svg+xml' },
    // 458 Italia -> Part -> Akrapovic
    { path: 'Ferrari/458-Italia/Part/Akrapovic/logo.png', buffer: labLogo, mime: 'image/png' },
    { path: 'Ferrari/458-Italia/Part/Akrapovic/Titanium-Slip-On.jpg', buffer: createFallbackBuffer('Akrapovic Titanium Slip-On'), mime: 'image/svg+xml' },

    // --- Toyota ---
    { path: 'Toyota/logo.png', buffer: toyotaLogo, mime: 'image/svg+xml' },
    // GT86
    { path: 'Toyota/GT86/CarPicture.jpg', buffer: carPic2, mime: 'image/jpeg' },
    // GT86 -> BodyKit -> Sano-Design
    { path: 'Toyota/GT86/BodyKit/Sano-Design/logo.png', buffer: labLogo, mime: 'image/png' },
    { path: 'Toyota/GT86/BodyKit/Sano-Design/V2-Widebody-Fenders.png', buffer: createFallbackBuffer('Sano V2 Widebody Fenders'), mime: 'image/svg+xml' },
    { path: 'Toyota/GT86/BodyKit/Sano-Design/Carbon-Front-Lip.png', buffer: createFallbackBuffer('Sano Carbon Front Lip'), mime: 'image/svg+xml' },
    // GT86 -> BodyKit -> Rocket-Bunny
    { path: 'Toyota/GT86/BodyKit/Rocket-Bunny/logo.png', buffer: labLogo, mime: 'image/png' },
    { path: 'Toyota/GT86/BodyKit/Rocket-Bunny/V3-Full-Aero-Kit.png', buffer: createFallbackBuffer('Rocket Bunny V3 Full Aero Kit'), mime: 'image/svg+xml' },
    // GT86 -> Part -> Enkei
    { path: 'Toyota/GT86/Part/Enkei/logo.png', buffer: labLogo, mime: 'image/png' },
    { path: 'Toyota/GT86/Part/Enkei/RPF1-Silver-18inch.png', buffer: createFallbackBuffer('Enkei RPF1 Silver 18"'), mime: 'image/svg+xml' },
    { path: 'Toyota/GT86/Part/Enkei/NT03RR-Matte-Dark-Gunmetallic.png', buffer: createFallbackBuffer('Enkei NT03RR Matte Gunmetal'), mime: 'image/svg+xml' },
    // GT86 -> Part -> Tomei
    { path: 'Toyota/GT86/Part/Tomei/logo.png', buffer: labLogo, mime: 'image/png' },
    { path: 'Toyota/GT86/Part/Tomei/Expreme-Ti-Titanium-Catback.jpg', buffer: createFallbackBuffer('Tomei Expreme Ti Catback'), mime: 'image/svg+xml' },

    // --- Lamborghini ---
    { path: 'Lamborghini/logo.png', buffer: lamborghiniLogo, mime: 'image/png' },
    { path: 'Lamborghini/Revuelto/CarPicture.jpg', buffer: carPic2, mime: 'image/jpeg' },
    { path: 'Lamborghini/Revuelto/BodyKit/Mansory/logo.png', buffer: labLogo, mime: 'image/png' },
    { path: 'Lamborghini/Revuelto/BodyKit/Mansory/Carbon-Aero-Pack.png', buffer: createFallbackBuffer('Mansory Carbon Aero Pack'), mime: 'image/svg+xml' },
    { path: 'Lamborghini/Revuelto/Part/Akrapovic/logo.png', buffer: labLogo, mime: 'image/png' },
    { path: 'Lamborghini/Revuelto/Part/Akrapovic/Titanium-Exhaust.jpg', buffer: createFallbackBuffer('Akrapovic Titanium Exhaust'), mime: 'image/svg+xml' },

    // --- Honda ---
    { path: 'Honda/logo.png', buffer: hondaLogo, mime: 'image/svg+xml' },
    { path: 'Honda/Civic-Type-R/CarPicture.jpg', buffer: carPic1, mime: 'image/png' },
    { path: 'Honda/Civic-Type-R/BodyKit/Mugen/logo.png', buffer: labLogo, mime: 'image/png' },
    { path: 'Honda/Civic-Type-R/BodyKit/Mugen/Aero-Dynamics-Kit.png', buffer: createFallbackBuffer('Mugen Aero Dynamics Kit'), mime: 'image/svg+xml' },
    { path: 'Honda/Civic-Type-R/Part/Spoon-Sports/logo.png', buffer: labLogo, mime: 'image/png' },
    { path: 'Honda/Civic-Type-R/Part/Spoon-Sports/Monobloc-Caliper-Set.png', buffer: createFallbackBuffer('Spoon Monobloc Caliper'), mime: 'image/svg+xml' },
  ];

  for (const item of filesToUpload) {
    await uploadFile(item.path, item.buffer, item.mime);
  }

  console.log('\n✨ Completed seeding STORAGE_CATALOG_TREE to Supabase Storage `catalog` bucket!');
}

main().catch(console.error);
