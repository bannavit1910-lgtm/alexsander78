const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// สำคัญ: Render (และ hosting ส่วนใหญ่) ใช้ดิสก์แบบชั่วคราว (ephemeral) —
// ไฟล์รูปที่อัปโหลดผ่านฟอร์มจะถูกลบทิ้งทุกครั้งที่ deploy ใหม่หรือรีสตาร์ทเซิร์ฟเวอร์
// จึงต้องอัปโหลดรูปไปเก็บที่ Cloudinary (พื้นที่เก็บรูปแบบถาวรบนคลาวด์) แทนการเก็บไว้ในดิสก์ของเซิร์ฟเวอร์เอง
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'alexsander-store/products',
    allowed_formats: ['png', 'jpg', 'jpeg', 'webp'],
    // ตั้งชื่อไฟล์ให้ไม่ชนกัน
    public_id: (req, file) => `product_${Date.now()}_${Math.round(Math.random() * 1e6)}`,
  },
});

function fileFilter(req, file, cb) {
  const allowed = ['image/png', 'image/jpeg', 'image/webp'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('รองรับเฉพาะไฟล์รูปภาพ PNG, JPG, WEBP เท่านั้น'));
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// อัปโหลดรูปแบนเนอร์หมวดหมู่ (เก็บแยกโฟลเดอร์บน Cloudinary เพื่อไม่ปนกับรูปสินค้า)
const bannerStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'alexsander-store/banners',
    allowed_formats: ['png', 'jpg', 'jpeg', 'webp'],
    public_id: (req, file) => `banner_${Date.now()}_${Math.round(Math.random() * 1e6)}`,
  },
});

const uploadBanner = multer({
  storage: bannerStorage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

module.exports = upload;
module.exports.cloudinary = cloudinary;
module.exports.uploadBanner = uploadBanner;
