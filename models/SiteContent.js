// models/SiteContent.js
// เก็บข้อความหน้าแรกที่แอดมินแก้ไขได้ (หัวข้อ + คำโปรยใต้หัวข้อ ในส่วน hero ด้านบนสุดของหน้าแรก)
// ใช้เอกสารเดียว (key: 'homepage') เป็นค่าตั้งต้นของทั้งเว็บ
const mongoose = require('mongoose');

const siteContentSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    default: 'homepage',
  },
  hero_heading: {
    type: String,
    // ข้อความหัวข้อใหญ่ — กด Enter เพื่อขึ้นบรรทัดใหม่ได้ และล้อมคำด้วย ** เพื่อไฮไลต์สีทอง เช่น "ระดับ **เทพ** ในที่เดียว"
  },
  hero_subtitle: {
    type: String,
    // ข้อความบรรทัดรองใต้หัวข้อใหญ่
  },
  hero_image_path: {
    type: String,
    // URL รูปภาพฝั่ง hero (แทนที่ภาพตัวละครเริ่มต้น) — ไม่บังคับสัดส่วน ปรับตามขนาดรูปที่อัปโหลดจริง แนะนำแนวนอนแบบปกยูทูป (1280x720)
  },
  hero_image_public_id: {
    type: String,
    // ใช้สำหรับลบรูปเดิมออกจาก Cloudinary ตอนเปลี่ยน/รีเซ็ตรูป
  },
  updated_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('SiteContent', siteContentSchema);
