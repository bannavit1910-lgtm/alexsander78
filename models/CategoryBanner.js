// models/CategoryBanner.js
// เก็บข้อความและรูปภาพของแบนเนอร์หมวดหมู่ (เช่น FREEFIRE, ROV) ที่แอดมินปรับแต่งเอง
// หมวดหมู่ละ 1 แบนเนอร์ — ถ้าไม่มีข้อมูลในนี้ หน้าเว็บจะ fallback ไปใช้ชื่อหมวดหมู่ + จำนวนสินค้าแบบเดิม
const mongoose = require('mongoose');

const categoryBannerSchema = new mongoose.Schema({
  category: {
    type: String,
    required: true,
    unique: true, // อิงตามชื่อหมวดหมู่ของสินค้า (Product.category)
  },
  title: {
    type: String, // ข้อความหัวข้อที่แอดมินกำหนดเอง เช่น "FREEFIRE" — ถ้าว่างจะใช้ชื่อหมวดหมู่แทน
  },
  subtitle: {
    type: String, // ข้อความบรรทัดรองที่แอดมินกำหนดเอง — ถ้าว่างจะใช้ "มีสินค้า N รายการ พร้อมจำหน่าย" แทน
  },
  image_path: {
    type: String, // URL รูปบน Cloudinary (เก็บถาวร ไม่หายตอน deploy ใหม่)
  },
  image_public_id: {
    type: String, // ใช้สำหรับลบรูปเดิมออกจาก Cloudinary ตอนเปลี่ยน/รีเซ็ตรูป
  },
  updated_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // แอดมินคนล่าสุดที่แก้ไขแบนเนอร์นี้
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('CategoryBanner', categoryBannerSchema);
