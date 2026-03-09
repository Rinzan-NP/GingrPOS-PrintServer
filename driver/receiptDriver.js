/**
 * GingrPOS Receipt Driver — 80mm / 58mm Thermal Printer
 *
 * Formats a GingrPOS order object into ESC/POS bytes.
 * Matches the GingrPOS ElectronReceipt80mm.js layout exactly.
 *
 * Layout (80mm = 48 chars, 58mm = 32 chars):
 *   ================================================
 *             STORE NAME
 *             Address Line 1
 *             Ph: xxx | email
 *             GSTIN: xxx
 *   ================================================
 *   Bill: INV-001          Date: 23/02/2026
 *   Order: Dine In         Time: 17:30
 *   ------------------------------------------------
 *   Cust: John Doe                  *****90
 *   ------------------------------------------------
 *   ITEM                                       AMT
 *   ------------------------------------------------
 *   Chicken Burger                          [1234]
 *     2 x 250.00  5%                         500.00
 *     GST@5%(Exc) Taxable:500.00  Tax:25.00
 *   ------------------------------------------------
 *                     TAX SUMMARY
 *   ------------------------------------------------
 *   5%     500.00    12.50    12.50     25.00
 *   ================================================
 *   Taxable Amount:                         500.00
 *   Total Tax (CGST+SGST):                   25.00
 *   ================================================
 *   GRAND TOTAL:                            525.00
 *   ================================================
 *   Payment Method: CASH
 *
 *               Thank You! Visit Again
 *                 ** Tax Invoice **
 *               Powered by GingrPOS
 */

'use strict';

const ESCPOSBuilder = require('../utils/escpos');

// ────────────────── FORMATTING HELPERS ──────────────────

function formatDate(d) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

function formatTime(d) {
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${min}`;
}

function fmtMoney(amount) {
    return parseFloat(amount || 0).toFixed(2);
}

function padLeft(str, len) {
    const s = String(str || '');
    return s.length >= len ? s : ' '.repeat(len - s.length) + s;
}

function padRight(str, len) {
    const s = String(str || '');
    return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

function centeredStr(str, width) {
    const s = String(str || '');
    const pad = Math.max(0, Math.floor((width - s.length) / 2));
    return ' '.repeat(pad) + s;
}

function rowStr(left, right, width) {
    const l = String(left || '');
    const r = String(right || '');
    const space = width - l.length - r.length;
    if (space < 1) return l.substring(0, width - r.length - 1) + ' ' + r;
    return l + ' '.repeat(space) + r;
}

function wrapText(str, maxWidth) {
    const words = String(str || '').split(' ');
    const lines = [];
    let cur = words[0] || '';
    for (let i = 1; i < words.length; i++) {
        if (cur.length + 1 + words[i].length <= maxWidth) {
            cur += ' ' + words[i];
        } else {
            lines.push(cur);
            cur = words[i];
        }
    }
    lines.push(cur);
    return lines;
}

// ──────────────────────── MAIN ──────────────────────────

/**
 * Generate an ESC/POS receipt buffer from a GingrPOS order.
 *
 * @param {Object} data
 * @param {Object} data.order       - Order object
 * @param {Object} data.store       - Store / shop config
 * @param {Object} [data.config]    - { paperWidth: 80|58, taxEnabled: true, unsettled: false }
 * @returns {Buffer} ESC/POS bytes
 */
function generateReceipt(data) {
    const { order = {}, store = {}, config = {} } = data;
    const paperWidth = config.paperWidth === 58 ? 58 : 80;
    const width      = paperWidth === 58 ? 32 : 48;
    const taxEnabled = config.taxEnabled !== false;

    const b = new ESCPOSBuilder(width);
    b.init().fontA();

    const SEP_EQ = '='.repeat(width);
    const SEP_DH = '-'.repeat(width);

    const ln  = (s) => b.textLn(s); // raw line
    const cln = (s) => b.textLn(centeredStr(s, width));
    const rln = (l, r) => b.textLn(rowStr(l, r, width));

    // ══════════════════════ HEADER ══════════════════════
    ln(SEP_EQ);

    if (store.name) {
        cln(store.name.toUpperCase());
    }
    if (store.address) {
        wrapText(store.address, width).forEach(l => cln(l.trim()));
    }
    if (store.phone) cln(`Ph: ${store.phone}`);
    if (store.email) cln(store.email);
    if (store.gstNumber || store.gstin) {
        cln(`GSTIN: ${store.gstNumber || store.gstin}`);
    }
    if (store.licenseNumber) cln(`Lic No: ${store.licenseNumber}`);

    ln(SEP_EQ);

    // UNSETTLED banner
    if (config.unsettled) {
        b.bold(true).invert(true);
        cln('*** UNSETTLED ***');
        b.invert(false).bold(false);
    }

    // ══════════════════════ META ════════════════════════
    const dateObj = new Date(order.createdAt || order.date || new Date());
    const dateStr = formatDate(isNaN(dateObj) ? new Date() : dateObj);
    const timeStr = formatTime(isNaN(dateObj) ? new Date() : dateObj);

    rln(`Bill : ${order.billNumber || order.id || 'N/A'}`, `Date: ${dateStr}`);
    rln(`Order: ${order.orderType || order.terminalName || 'Walk-in'}`, `Time: ${timeStr}`);
    ln(SEP_DH);

    // ══════════════════════ CUSTOMER ════════════════════
    if (order.customer) {
        const custName = order.customer.name || 'Guest';
        let phone = String(order.customer.phone || '');
        if (phone.length > 4) {
            phone = phone.substring(0, 3) + '*****' + phone.slice(-2);
        }
        rln(`Cust: ${custName}`, phone);
        if (order.customer.points || order.customer.loyaltyTier) {
            const pts = order.customer.points || 0;
            const tier = order.customer.loyaltyTier ? ` (${order.customer.loyaltyTier})` : '';
            rln(`Points Balance: ${pts}`, tier);
        }
    } else {
        ln('Customer: Guest');
    }
    ln(SEP_DH);

    // ══════════════════════ ITEMS ═══════════════════════
    rln('ITEM', 'AMT');
    ln(SEP_DH);

    let totalTaxableValue = 0;
    let totalTaxAmountExcl = 0;
    let totalTaxAmountIncl = 0;
    const taxDetails = {};

    (order.items || []).forEach(item => {
        const qty   = Number(item.qt || item.quantity || 1);
        const price = Number(item.price || item.unit_price || 0);
        const total = Number(item.total || (price * qty));

        // Line 1: Name [HSN]
        const itemName = String(item.name || 'Item');
        const hsn      = item.hsn ? `[${item.hsn}]` : '';
        if (hsn) {
            const maxNameLen = width - hsn.length - 1;
            const truncName  = itemName.length > maxNameLen ? itemName.substring(0, maxNameLen) : itemName;
            b.textLn(rowStr(truncName, hsn, width));
        } else {
            ln(itemName.substring(0, width));
        }

        // Line 2: Qty x Rate   Tax%     Amount
        const isFree = item.isFree || parseFloat(item.price || item.unit_price) === 0;
        const priceVal = isFree ? 'Free' : fmtMoney(price);
        const amtVal   = isFree ? 'Free' : fmtMoney(total);
        let rate = 0;
        if (taxEnabled) {
            if (item.gst)      rate = Number(item.gst);
            else if (item.tax_rate) rate = Number(item.tax_rate);
        }
        const taxStr  = rate > 0 ? `${rate}%` : '';
        const qtyLine = `  ${qty} x ${priceVal}`;
        const leftPart = taxStr ? `${qtyLine}  ${taxStr}` : qtyLine;
        b.textLn(rowStr(leftPart, amtVal, width));

        // MRP Savings
        const mrp = Number(item.mrp || 0);
        if (mrp > 0 && mrp > price && !isFree) {
            const savings = (mrp - price) * qty;
            ln(`  MRP: ${fmtMoney(mrp)}  (Save ${fmtMoney(savings)})`);
        }

        // Item discount
        const itemDiscount = item.discountAmount || item.discounts || 0;
        if (itemDiscount > 0) ln(`  (Disc: -${fmtMoney(itemDiscount)})`);

        // Tax accumulation
        const isInclusive = item.taxType === 'inclusive' || item.tax_inclusive || item.taxIncluded;
        let itemTaxable = 0, itemTax = 0;

        if (rate > 0) {
            if (isInclusive) {
                itemTaxable = (total * 100) / (100 + rate);
                itemTax     = total - itemTaxable;
                totalTaxAmountIncl += itemTax;
            } else {
                itemTaxable = total;
                itemTax     = (itemTaxable * rate) / 100;
                totalTaxAmountExcl += itemTax;
            }
        } else {
            itemTaxable = total;
        }
        totalTaxableValue += itemTaxable;

        const taxKey = `${rate}_${isInclusive ? 'incl' : 'excl'}`;
        if (!taxDetails[taxKey]) {
            taxDetails[taxKey] = { rate, taxable: 0, tax: 0, inclusive: isInclusive };
        }
        taxDetails[taxKey].taxable += itemTaxable;
        taxDetails[taxKey].tax     += itemTax;

        // Per-item GST detail
        if (rate > 0) {
            const typeStr = isInclusive ? 'Inc' : 'Exc';
            ln(`  GST@${rate}%(${typeStr}) Taxable:${fmtMoney(itemTaxable)} Tax:${fmtMoney(itemTax)}`);
        }
    });

    ln(SEP_DH);

    // ══════════════════════ TAX SUMMARY ═════════════════
    cln('TAX SUMMARY');
    ln(SEP_DH);

    const allKeys  = Object.keys(taxDetails);
    const inclKeys = allKeys.filter(k => taxDetails[k].inclusive).sort((a, b) => parseFloat(a) - parseFloat(b));
    const exclKeys = allKeys.filter(k => !taxDetails[k].inclusive).sort((a, b) => parseFloat(a) - parseFloat(b));

    const taxRow = (d) => {
        const cgst = d.tax / 2;
        const sgst = d.tax / 2;
        // Rate(6) | Taxable(w1) | CGST(w2) | SGST(w2) | Total(w3)
        const w1 = width === 48 ? 11 : 7;
        const w2 = width === 48 ? 10 : 6;
        const w3 = width === 48 ? 11 : 7;
        return padRight(`${d.rate}%`, width - w1 - w2 - w2 - w3)
            + padLeft(fmtMoney(d.taxable), w1)
            + padLeft(fmtMoney(cgst), w2)
            + padLeft(fmtMoney(sgst), w2)
            + padLeft(fmtMoney(d.tax), w3);
    };

    if (inclKeys.length > 0) {
        cln('(Included in Price)');
        inclKeys.forEach(k => ln(taxRow(taxDetails[k])));
        if (exclKeys.length > 0) ln(SEP_DH);
    }
    exclKeys.forEach(k => ln(taxRow(taxDetails[k])));

    ln(SEP_EQ);

    // ══════════════════════ TOTALS ═══════════════════════
    rln('Taxable Amount:', fmtMoney(totalTaxableValue));
    rln('Total Tax (CGST+SGST):', fmtMoney(totalTaxAmountExcl + totalTaxAmountIncl));
    ln(SEP_DH);

    // Charges
    if (order.charges && order.charges.length > 0) {
        order.charges.forEach(c => {
            const amt = c.amount || c.value || 0;
            if (amt > 0) rln(`${c.name || 'Charge'}:`, fmtMoney(amt));
        });
    }

    // Discount
    const discount = order.discount || 0;
    if (discount > 0) rln('Discount:', `-${fmtMoney(discount)}`);

    // Voucher
    if (order.voucherCode) {
        const vAmt = order.voucherAmount || order.voucher_discount || 0;
        rln(`Voucher (${order.voucherCode}):`, `-${fmtMoney(vAmt)}`);
    }

    ln(SEP_EQ);
    b.bold(true);
    rln('GRAND TOTAL:', fmtMoney(order.total || order.grand_total));
    b.bold(false);
    ln(SEP_EQ);

    // ══════════════════════ PAYMENT ═══════════════════════
    const pMethod = order.paymentMethod || 'Cash';
    ln(`Payment Method: ${pMethod.toUpperCase()}`);

    if (order.payments && order.payments.length > 0) {
        order.payments.forEach(p => {
            rln(`  ${p.method}:`, fmtMoney(p.amount));
        });
    }
    ln(SEP_DH);

    // ══════════════════════ CREDIT SUMMARY ════════════════
    if (order.customer && order.customer.balance != null) {
        ln('Credit Summary');
        const prev = order.customer.prevBalance !== undefined ? fmtMoney(order.customer.prevBalance) : '0.00';
        rln('Previous Due:', prev);
        rln('Current Bill:', fmtMoney(order.total));
        ln(SEP_DH);
        rln('TOTAL OUTSTANDING:', fmtMoney(order.customer.balance));
        ln(SEP_EQ);
    }

    // ══════════════════════ NOTES ═════════════════════════
    const noteText = (order.notes || order.note || '').trim();
    if (noteText) {
        ln('Note:');
        wrapText(noteText, width).forEach(l => ln(l));
        ln(SEP_EQ);
    }

    // ══════════════════════ FOOTER ═══════════════════════
    cln('Thank You! Visit Again');
    cln('** Tax Invoice **');

    if (store.footerText) {
        wrapText(store.footerText, width).forEach(l => cln(l.trim()));
    }

    b.newLine(1);
    cln('Powered by GingrPOS');
    b.newLine(1);

    b.cut();
    return b.toBuffer();
}

module.exports = { generateReceipt };
