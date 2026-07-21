const crypto = require('crypto');
const Order = require('../models/Order');

// รหัสคำสั่งซื้อ: # + ตัวอักษรอังกฤษพิมพ์เล็ก/ตัวเลข 13 หลัก เช่น #fviohs32472fd
const CODE_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LENGTH = 13;

function randomCode(length) {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  }
  return code;
}

// สุ่มรหัสคำสั่งซื้อและเช็คกับฐานข้อมูลให้แน่ใจว่าไม่ซ้ำกับรายการเดิม
async function generateUniqueOrderCode() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = `#${randomCode(CODE_LENGTH)}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await Order.findOne({ order_code: code }).select('_id').lean();
    if (!exists) return code;
  }
  // กรณีสุดวิสัยที่สุ่มชนกันติดๆ กันหลายครั้ง (แทบเป็นไปไม่ได้) ต่อ timestamp ท้ายเพื่อการันตีว่าไม่ซ้ำ
  return `#${randomCode(CODE_LENGTH)}${Date.now().toString(36)}`;
}

module.exports = { generateUniqueOrderCode };
