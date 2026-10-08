import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export const qrPayload = code => `ETICKET:${code}`;
export const prettyCode = code => String(code).match(/.{1,4}/g).join('-');
export const longDate = date => new Date(`${date}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
export const money = n => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);

export function qrSvg(code) {
  return QRCode.toString(qrPayload(code), { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
}

// One A5 page per ticket: event data, a QR drawn from its modules and the code to type by hand.
export function ticketPdf(t) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A5', margin: 32, info: { Title: `Boleto · ${t.eventName}`, Author: 'eTicket' } });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const width = doc.page.width;
    doc.rect(0, 0, width, 72).fill('#161826');
    doc.fill('#d2cefd').font('Helvetica-Bold').fontSize(22).text('eTicket', 32, 22);
    doc.fill('#9184d9').font('Helvetica').fontSize(9).text('Boleto electrónico · válido para un solo acceso', 32, 48);
    doc.fill('#161826').font('Helvetica-Bold').fontSize(19).text(t.eventName, 32, 94, { width: width - 64 });
    const rows = [
      ['Función', `${longDate(t.date)} · ${t.hour} h`],
      ['Lugar', [t.venue, t.city].filter(Boolean).join(', ')],
      ['Zona', t.kind === 'seat' ? `${t.zone} · Asiento ${t.seat}` : `${t.zone} · ${t.seat}`],
      ['Titular', t.owner],
      ['Orden', t.orderId],
    ];
    let y = doc.y + 12;
    for (const [label, value] of rows) {
      doc.fill('#6b6880').font('Helvetica').fontSize(9).text(label.toUpperCase(), 32, y);
      doc.fill('#161826').font('Helvetica-Bold').fontSize(11).text(value || '—', 110, y - 1, { width: width - 142 });
      y = Math.max(doc.y, y + 14) + 6;
    }
    const qr = QRCode.create(qrPayload(t.code), { errorCorrectionLevel: 'M' });
    const modules = qr.modules.size, box = 200, cell = box / (modules + 4), x0 = (width - box) / 2, y0 = y + 14;
    doc.rect(x0, y0, box, box).fill('#ffffff');
    for (let r = 0; r < modules; r++) for (let c = 0; c < modules; c++) if (qr.modules.get(r, c)) doc.rect(x0 + (c + 2) * cell, y0 + (r + 2) * cell, cell, cell);
    doc.fill('#000000');
    doc.rect(x0, y0, box, box).lineWidth(1).stroke('#d2cefd');
    doc.fill('#161826').font('Courier-Bold').fontSize(15).text(prettyCode(t.code), 32, y0 + box + 14, { width: width - 64, align: 'center' });
    doc.fill('#6b6880').font('Helvetica').fontSize(8.5)
      .text('Si la cámara no lee el QR, el personal puede escribir este código.', 32, doc.y + 4, { width: width - 64, align: 'center' })
      .text('Proyecto escolar eTicket · Pagos en sandbox, sin validez comercial.', 32, doc.page.height - 48, { width: width - 64, align: 'center' });
    doc.end();
  });
}
