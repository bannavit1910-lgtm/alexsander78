// utils/textFormat.js
// แปลงข้อความที่แอดมินพิมพ์เอง (hero heading/subtitle) ให้ปลอดภัยก่อนแสดงผลเป็น HTML
// escape ตัวอักษรพิเศษก่อนเสมอ กัน XSS จากช่องกรอกข้อความในแอดมิน แล้วค่อยแปลง ** และ \n เป็น tag

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// สำหรับข้อความหัวข้อ: รองรับการขึ้นบรรทัดใหม่ (\n -> <br>) และไฮไลต์คำด้วย **คำ** -> <span>คำ</span>
function renderHeroHeading(raw) {
  const escaped = escapeHtml(raw);
  const withHighlight = escaped.replace(/\*\*(.+?)\*\*/g, '<span>$1</span>');
  return withHighlight.replace(/\r?\n/g, '<br>');
}

// สำหรับข้อความทั่วไป (เช่น คำโปรยใต้หัวข้อ): รองรับแค่การขึ้นบรรทัดใหม่ ไม่มีไฮไลต์
function renderPlainText(raw) {
  return escapeHtml(raw).replace(/\r?\n/g, '<br>');
}

module.exports = { escapeHtml, renderHeroHeading, renderPlainText };
