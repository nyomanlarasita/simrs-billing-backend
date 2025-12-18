require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// Konfigurasi Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// --- 1. ENDPOINT UNTUK MASTER DATA ---

// Ambil List Obat (Untuk Dropdown di Input & Billing)
app.get('/api/medicines', async (req, res) => {
    const { data, error } = await supabase.from('medicines').select('*').order('name');
    if (error) return res.status(500).json(error);
    res.json(data);
});

// Ambil List Supplier
app.get('/api/suppliers', async (req, res) => {
    const { data, error } = await supabase.from('suppliers').select('id, name').order('name');
    if (error) return res.status(500).json(error);
    res.json(data);
});

// --- 2. ENDPOINT PENGADAAN (TUGAS LARAS) ---

// Simpan PO & Update Stok Otomatis
app.post('/api/purchase-orders/full', async (req, res) => {
    const { supplier_id, po_number, items } = req.body;

    try {
        // 1. Simpan Header PO
        const { data: po, error: poErr } = await supabase.from('purchase_orders')
            .insert([{ 
                supplier_id, 
                po_number, 
                status: 'COMPLETED', 
                order_date: new Date() 
            }]).select().single();
        
        if (poErr) throw poErr;

        // 2. Proses Setiap Item (Update Stok & Hitung Harga Jual)
        for (const item of items) {
            // Ambil data obat saat ini (terutama HNA dan Margin)
            const { data: med } = await supabase.from('medicines')
                .select('*')
                .eq('id', item.medicine_id)
                .single();
            
            // Hitung Harga Jual Otomatis (HNA + Margin + PPN)
            // Rumus: HNA * (1 + Margin%) * (1 + PPN 11%)
            const hna = parseFloat(med.hna_price) || 0;
            const margin = 1 + (med.margin_percentage / 100);
            const ppn = 1.11;
            const hargaJualBaru = Math.round(hna * margin * ppn);

            // Update Stok dan Harga Jual di Tabel Master Medicines
            const stokBaru = (parseInt(med.stock) || 0) + parseInt(item.qty);
            await supabase.from('medicines').update({ 
                stock: stokBaru,
                selling_price: hargaJualBaru 
            }).eq('id', item.medicine_id);

            // Simpan Detail Transaksi PO
            await supabase.from('purchase_order_details').insert({
                po_id: po.id,
                medicine_id: item.medicine_id,
                qty_ordered: item.qty,
                buy_price: hna // Menggunakan HNA dari database
            });
        }

        res.json({ success: true, message: "Stok dan Harga Berhasil Diperbarui" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- 3. ENDPOINT AUDIT/VERIFIKASI (UNTUK BILLING) ---

// Cek Detail PO Berdasarkan Nomor
app.get('/api/purchase-orders/check/:poNumber', async (req, res) => {
    const { data, error } = await supabase
        .from('purchase_orders')
        .select(`
            id, po_number, order_date,
            purchase_order_details (
                qty_ordered, buy_price,
                medicines ( name, selling_price )
            )
        `)
        .eq('po_number', req.params.poNumber)
        .single();

    if (error || !data) return res.status(404).json({ success: false, message: "PO Tidak Ditemukan" });
    res.json({ success: true, data });
});

// Port Server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`
    ==========================================
    SIMRS FARMASI SERVER RUNNING
    Role: Laras (Database & Stock Engineer)
    Port: ${PORT}
    ==========================================
    `);
});