// ==========================================
// 1. INISIALISASI SUPABASE & VARIABEL GLOBAL
// ==========================================
const supabaseUrl = 'https://umrtkyvjpngjdreijczl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtcnRreXZqcG5namRyZWlqY3psIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMzUwMDEsImV4cCI6MjEwMTcxMTAwMX0.aX6XdnyeOUP3cQXGmBccL-d1rFdQTILOo9yeBSUygKA';

const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);

let currentUser = null;
let currentProfile = null;
let officeData = { lat: 5.187745, lng: 97.147974, radius: 500 }; // Default MAN Lhokseumawe
let userLocation = null;
let userMap, userMarker, userCircle;
let adminMap, adminMarker, adminCircle;

// ==========================================
// 2. AUTENTIKASI & ROUTING
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        await loadUserProfile(session.user);
    } else {
        showView('login-view');
    }
    
    // Setup form login
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            
            const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) return alert('Login gagal: ' + error.message);
            
            await loadUserProfile(data.user);
        });
    }
});

async function loadUserProfile(user) {
    currentUser = user;
    const { data, error } = await supabaseClient.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error || !data) return alert('Gagal mengambil profil');
    currentProfile = data;

    if (currentProfile.role === 'admin') {
        showView('admin-view');
        initAdminMap();
        initAdminDashboard();
    } else {
        showView('user-view');
        await loadOfficeSettings();
        
        // Inisialisasi peta & status presensi user
        if (typeof initUserDashboard === 'function') {
            initUserDashboard();
        }
        if (typeof checkTodayAttendance === 'function') {
            await checkTodayAttendance();
        }
        if (typeof loadUserHistory === 'function') {
            loadUserHistory();
        }
    }
}

async function logout() {
    await supabaseClient.auth.signOut();
    window.location.reload();
}

function showView(viewId) {
    ['login-view', 'user-view', 'admin-view'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add('hidden');
            el.classList.remove('flex');
        }
    });
    const target = document.getElementById(viewId);
    if (target) {
        target.classList.remove('hidden');
        target.classList.add('flex');
    }
}

// ==========================================
// 3. PENGATURAN KANTOR & LOKASI
// ==========================================
async function loadOfficeSettings() {
    const { data, error } = await supabaseClient.from('office_settings').select('*').eq('id', 1).maybeSingle();
    if (data) officeData = { lat: data.latitude, lng: data.longitude, radius: data.radius_meters };
}

// Menghitung jarak menggunakan fungsi Leaflet
function calculateDistance(lat, lng) {
    const fromCoord = L.latLng(lat, lng);
    const toCoord = L.latLng(officeData.lat, officeData.lng);
    const distance = fromCoord.distanceTo(toCoord); // dalam meter

    const infoEl = document.getElementById('distance-info');
    const radiusBadge = document.getElementById('radius-indicator-badge');

    if (infoEl) {
        if (distance <= officeData.radius) {
            infoEl.innerHTML = `Jarak Anda: <b>${Math.round(distance)} meter</b> dari sekolah. <span class="text-emerald-600 font-semibold">(Dalam Radius Valid)</span>`;
            infoEl.dataset.valid = "true";
            if (radiusBadge) {
                radiusBadge.className = "px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-lg";
                radiusBadge.innerText = "Dalam Radius";
            }
        } else {
            infoEl.innerHTML = `Jarak Anda: <b>${Math.round(distance)} meter</b> dari sekolah. <span class="text-rose-600 font-semibold">(Di Luar Radius ${officeData.radius}m)</span>`;
            infoEl.dataset.valid = "false";
            if (radiusBadge) {
                radiusBadge.className = "px-2.5 py-1 bg-rose-50 text-rose-700 text-xs font-semibold rounded-lg";
                radiusBadge.innerText = "Di Luar Radius";
            }
        }
    }
}

// Alias fungsi untuk kompatibilitas pemanggilan
function calculateDistanceAndStatus() {
    if (userLocation) {
        calculateDistance(userLocation.lat, userLocation.lng);
    }
}

// ==========================================
// 4. PEMETAAN & PRESENSI USER (GURU/TENDIK)
// ==========================================
function initUserDashboard() {
    // Hapus peta lama jika ada agar tidak terjadi error container reuse
    if (userMap) {
        userMap.remove();
    }

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
            userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            
            // Render Peta Leaflet baru
            userMap = L.map('user-map').setView([userLocation.lat, userLocation.lng], 17);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap contributors'
            }).addTo(userMap);

            userMarker = L.marker([userLocation.lat, userLocation.lng]).addTo(userMap)
                .bindPopup('Posisi Anda')
                .openPopup();

            // Hitung jarak ke kantor
            calculateDistanceAndStatus();
        }, (err) => {
            alert('Gagal mendeteksi lokasi GPS: ' + err.message);
        }, { enableHighAccuracy: true });
    } else {
        alert('Browser Anda tidak mendukung Geolocation.');
    }
}

async function checkTodayAttendance() {
    const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }); 
    
    const { data, error } = await supabaseClient
        .from('attendance_logs')
        .select('*')
        .eq('user_id', currentProfile.id)
        .eq('date', dateStr)
        .maybeSingle();

    const statusTextEl = document.getElementById('current-status-text');
    const badgeContainer = document.getElementById('status-badge-container');
    const btnIn = document.getElementById('btn-clock-in');
    const btnOut = document.getElementById('btn-clock-out');

    if (data) {
        if (data.time_in) {
            if (btnIn) { btnIn.disabled = true; btnIn.classList.add('opacity-50', 'cursor-not-allowed'); }
            const timeInFormat = new Date(data.time_in).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' });
            if (statusTextEl) statusTextEl.innerText = `Sudah Clock In pada jam ${timeInFormat}`;
            if (badgeContainer) {
                badgeContainer.className = "inline-block px-3 py-1 bg-blue-50 text-blue-700 text-xs font-semibold rounded-full mb-3";
                badgeContainer.innerText = "Sudah Masuk";
            }
        }
        if (data.time_out) {
            if (btnOut) { btnOut.disabled = true; btnOut.classList.add('opacity-50', 'cursor-not-allowed'); }
            const timeOutFormat = new Date(data.time_out).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' });
            if (statusTextEl) statusTextEl.innerText = `Selesai Presensi Hari Ini (${timeOutFormat})`;
            if (badgeContainer) {
                badgeContainer.className = "inline-block px-3 py-1 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-full mb-3";
                badgeContainer.innerText = "Selesai Hari Ini";
            }
        } else if (data.time_in) {
            if (btnOut) { btnOut.disabled = false; btnOut.classList.remove('opacity-50', 'cursor-not-allowed'); }
        }
    } else {
        if (statusTextEl) statusTextEl.innerText = 'Belum melakukan presensi hari ini.';
        if (badgeContainer) {
            badgeContainer.className = "inline-block px-3 py-1 bg-amber-50 text-amber-700 text-xs font-semibold rounded-full mb-3";
            badgeContainer.innerText = "Belum Presensi";
        }
        if (btnOut) { btnOut.disabled = true; btnOut.classList.add('opacity-50', 'cursor-not-allowed'); }
    }
}

async function handleClockIn() {
    const infoEl = document.getElementById('distance-info');
    if (!infoEl || infoEl.dataset.valid !== "true") {
        return alert('Anda berada di luar radius area presensi sekolah!');
    }

    if (!userLocation) {
        return alert('Lokasi GPS belum ditemukan! Pastikan peta sudah memuat posisi Anda.');
    }
    
    const now = new Date();
    const wibOptions = { timeZone: 'Asia/Jakarta' };
    const dateStr = now.toLocaleDateString('en-CA', wibOptions); 
    const dayName = now.toLocaleDateString('id-ID', { weekday: 'long', timeZone: 'Asia/Jakarta' });
    const timeStr = now.toLocaleTimeString('id-ID', { hour12: false, timeZone: 'Asia/Jakarta' });
    
    if (dayName.toLowerCase() === 'minggu') {
        return alert('Hari ini libur. Presensi ditolak.');
    }

    const lateThreshold = "07:30:00";
    let status = timeStr > lateThreshold ? 'Terlambat' : 'Hadir Tepat Waktu';

    const { error } = await supabaseClient.from('attendance_logs').insert([{
        user_id: currentProfile.id,
        date: dateStr,
        time_in: now.toISOString(),
        lat_in: userLocation.lat,
        lng_in: userLocation.lng,
        status: status
    }]);

    if (error) {
        if (error.code === '23505') alert('Anda sudah melakukan Clock-In hari ini!');
        else alert('Gagal presensi: ' + error.message);
    } else {
        alert(`Clock-In Berhasil! Status: ${status}`);
        await checkTodayAttendance();
        loadUserHistory();
    }
}

async function handleClockOut() {
    if (!userLocation) return alert('Lokasi belum ditemukan!');

    const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

    const { error } = await supabaseClient.from('attendance_logs')
        .update({
            time_out: new Date().toISOString(),
            lat_out: userLocation.lat,
            lng_out: userLocation.lng
        })
        .eq('user_id', currentProfile.id)
        .eq('date', dateStr);
        
    if (error) {
        alert('Gagal melakukan Clock Out: ' + error.message);
    } else {
        alert('Clock-Out berhasil direkam.');
        await checkTodayAttendance();
        loadUserHistory();
    }
}

async function loadUserHistory() {
    const { data, error } = await supabaseClient.from('attendance_logs')
        .select('*')
        .eq('user_id', currentProfile.id)
        .order('date', { ascending: false })
        .limit(30);
        
    if (!error && data) {
        const tbody = document.getElementById('user-attendance-history');
        if(!tbody) return;
        tbody.innerHTML = '';
        
        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-400">Belum ada riwayat presensi.</td></tr>`;
            return;
        }

        data.forEach(log => {
            const timeIn = log.time_in ? new Date(log.time_in).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-';
            const timeOut = log.time_out ? new Date(log.time_out).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-';
            
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-50 transition border-b border-slate-50';
            tr.innerHTML = `
                <td class="p-3 font-medium text-slate-800">${formatDateID(log.date)}</td>
                <td class="p-3 text-slate-600">${timeIn}</td>
                <td class="p-3 text-slate-600">${timeOut}</td>
                <td class="p-3">
                    <span class="px-2.5 py-1 rounded-full text-xs font-semibold ${log.status === 'Terlambat' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}">
                        ${log.status || '-'}
                    </span>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }
}

// ==========================================
// 5. MODUL MANAJEMEN ADMIN
// ==========================================
async function initAdminDashboard() {
    initAdminMap();
    await loadAdminUsers();
    
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    const startDateInput = document.getElementById('filter-start-date');
    const endDateInput = document.getElementById('filter-end-date');
    
    if (startDateInput && !startDateInput.value) startDateInput.value = todayStr;
    if (endDateInput && !endDateInput.value) endDateInput.value = todayStr;
    
    await loadAdminAttendance();

    const formEl = document.getElementById('add-user-form');
    if (formEl) {
        formEl.removeEventListener('submit', handleAddUser);
        formEl.addEventListener('submit', handleAddUser);
    }
}

async function loadAdminAttendance() {
    const startDate = document.getElementById('filter-start-date').value;
    const endDate = document.getElementById('filter-end-date').value;
    
    let query = supabaseClient
        .from('attendance_logs')
        .select(`
            *,
            profiles:user_id (full_name, nip, role)
        `)
        .order('date', { ascending: false });

    if (startDate && endDate) {
        query = query.gte('date', startDate).lte('date', endDate);
    }

    const { data, error } = await query.limit(100);
    const tbody = document.getElementById('admin-attendance-table');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (error || !data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">Tidak ada data presensi pada rentang tanggal tersebut.</td></tr>`;
        return;
    }

    data.forEach(log => {
        const name = log.profiles ? log.profiles.full_name : 'Pengguna Dihapus';
        const nip = log.profiles && log.profiles.nip ? log.profiles.nip : '-';
        const role = log.profiles && log.profiles.role ? log.profiles.role.toUpperCase() : '-';
        const formattedDate = formatDateID(log.date);
        const timeIn = log.time_in ? new Date(log.time_in).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-';
        const timeOut = log.time_out ? new Date(log.time_out).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-';
        
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50 transition border-b';
        tr.innerHTML = `
            <td class="p-3.5 font-medium text-slate-800">${name}</td>
            <td class="p-3.5">${nip}</td>
            <td class="p-3.5">${formattedDate}</td>
            <td class="p-3.5">${timeIn}</td>
            <td class="p-3.5">${timeOut}</td>
            <td class="p-3.5">
                <span class="px-2.5 py-1 rounded-full text-xs font-semibold ${role === 'GURU' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'}">
                    ${role}
                </span>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function exportToExcel() {
    const startDate = document.getElementById('filter-start-date').value;
    const endDate = document.getElementById('filter-end-date').value;

    const { data, error } = await supabaseClient
        .from('attendance_logs')
        .select(`*, profiles:user_id (full_name, nip, role)`)
        .gte('date', startDate)
        .lte('date', endDate);

    if (error || !data || data.length === 0) {
        return alert('Tidak ada data untuk diexport pada rentang tanggal ini.');
    }

    const formattedData = data.map((item, index) => ({
        No: index + 1,
        "Nama Staf/Guru": item.profiles ? item.profiles.full_name : '-',
        "NIP/NIK": item.profiles ? item.profiles.nip : '-',
        Tanggal: formatDateID(item.date),
        "Jam Masuk": item.time_in ? new Date(item.time_in).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-',
        "Jam Pulang": item.time_out ? new Date(item.time_out).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-',
        "Guru/Tendik": item.profiles && item.profiles.role ? item.profiles.role.toUpperCase() : '-'
    }));

    const worksheet = XLSX.utils.json_to_sheet(formattedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Rekap Presensi");
    XLSX.writeFile(workbook, `Rekap_Presensi_${startDate}_hingga_${endDate}.xlsx`);
}

async function exportToPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    const startDate = document.getElementById('filter-start-date').value;
    const endDate = document.getElementById('filter-end-date').value;

    const { data, error } = await supabaseClient
        .from('attendance_logs')
        .select(`*, profiles:user_id (full_name, nip, role)`)
        .gte('date', startDate)
        .lte('date', endDate);

    if (error || !data || data.length === 0) {
        return alert('Tidak ada data untuk dicetak pada rentang tanggal ini.');
    }

    doc.setFontSize(14);
    doc.text("Laporan Presensi Kehadiran Staf & Guru", 14, 20);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`MAN Kota Lhokseumawe - Periode: ${formatDateID(startDate)} s/d ${formatDateID(endDate)}`, 14, 26);

    const tableRows = data.map((item, index) => [
        index + 1,
        item.profiles ? item.profiles.full_name : '-',
        item.profiles ? item.profiles.nip : '-',
        formatDateID(item.date),
        item.time_in ? new Date(item.time_in).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-',
        item.time_out ? new Date(item.time_out).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-',
        item.profiles && item.profiles.role ? item.profiles.role.toUpperCase() : '-'
    ]);

    doc.autoTable({
        startY: 32,
        head: [['No', 'Nama Staf / Guru', 'NIP/NIK', 'Tanggal', 'Jam Masuk', 'Jam Pulang', 'Guru/Tendik']],
        body: tableRows,
        theme: 'grid',
        headStyles: { fillColor: [30, 58, 138] },
    });

    doc.save(`Rekap_Presensi_${startDate}_hingga_${endDate}.pdf`);
}

function initAdminMap() {
    if (adminMap !== undefined && adminMap !== null) {
        adminMap.remove(); 
    }

    const mapContainer = document.getElementById('map-admin');
    if (!mapContainer) return;

    adminMap = L.map('map-admin').setView([officeData.lat, officeData.lng], 16);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(adminMap);

    adminMarker = L.marker([officeData.lat, officeData.lng], { draggable: true }).addTo(adminMap);
    
    adminCircle = L.circle([officeData.lat, officeData.lng], {
        color: 'red', fillColor: '#f03', fillOpacity: 0.2, radius: officeData.radius
    }).addTo(adminMap);

    const radiusInput = document.getElementById('radius-setting');
    if (radiusInput) radiusInput.value = officeData.radius;

    adminMarker.on('dragend', function (e) {
        const position = adminMarker.getLatLng();
        adminCircle.setLatLng(position); 
        officeData.lat = position.lat;
        officeData.lng = position.lng;
    });

    adminMap.on('click', function(e) {
        adminMarker.setLatLng(e.latlng);
        adminCircle.setLatLng(e.latlng);
        officeData.lat = e.latlng.lat;
        officeData.lng = e.latlng.lng;
    });

    if (radiusInput) {
        radiusInput.addEventListener('input', function(e) {
            const newRadius = parseInt(e.target.value) || 0;
            adminCircle.setRadius(newRadius);
            officeData.radius = newRadius;
        });
    }
}

async function saveOfficeSettings() {
    const radiusInput = document.getElementById('radius-setting').value;
    const radius = parseInt(radiusInput);
    
    if (!radius || radius <= 0) return alert('Radius harus berupa angka lebih dari 0.');

    const { error } = await supabaseClient.from('office_settings')
        .update({ latitude: officeData.lat, longitude: officeData.lng, radius_meters: radius })
        .eq('id', 1);

    if (error) {
        alert('Gagal menyimpan pengaturan: ' + error.message);
    } else {
        alert('Konfigurasi Lokasi dan Radius berhasil diperbarui!');
    }
}

async function loadAdminUsers() {
    const { data, error } = await supabaseClient.from('profiles').select('*').order('full_name', { ascending: true });
    const tbody = document.getElementById('admin-user-table');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (error || !data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-400">Belum ada pengguna terdaftar.</td></tr>`;
        return;
    }

    data.forEach(user => {
        let badgeColor = 'bg-slate-100 text-slate-800';
        if (user.role === 'admin') badgeColor = 'bg-purple-100 text-purple-800';
        else if (user.role === 'guru') badgeColor = 'bg-blue-100 text-blue-800';
        else if (user.role === 'tendik') badgeColor = 'bg-amber-100 text-amber-800';

        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50 transition border-b border-slate-50';
        tr.innerHTML = `
            <td class="p-3.5 font-medium text-slate-800">${user.full_name || '-'}</td>
            <td class="p-3.5 text-slate-500">${user.email || '-'}</td>
            <td class="p-3.5">
                <span class="px-2.5 py-1 rounded-full text-xs font-semibold uppercase ${badgeColor}">
                    ${user.role || '-'}
                </span>
            </td>
            <td class="p-3.5 text-center space-x-2">
                <button onclick="editUser('${user.id}')" class="bg-sky-500 text-white px-3 py-1 rounded text-xs font-medium hover:bg-sky-600 transition shadow-sm">Edit</button>
                <button onclick="deleteUser('${user.id}')" class="bg-rose-500 text-white px-3 py-1 rounded text-xs font-medium hover:bg-rose-600 transition shadow-sm">Hapus</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function editUser(userId) {
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

    if (error || !data) return alert("Gagal mengambil data pengguna.");

    document.getElementById('new-name').value = data.full_name;
    document.getElementById('new-email').value = data.email || '';
    document.getElementById('new-role').value = data.role;
    
    const passParent = document.getElementById('new-password').parentElement;
    if (passParent) passParent.classList.add('hidden');
    document.getElementById('new-nip').value = data.nip || '';

    const form = document.getElementById('add-user-form');
    form.onsubmit = async (e) => {
        e.preventDefault();
        
        const { error: updateError } = await supabaseClient
            .from('profiles')
            .update({
                full_name: document.getElementById('new-name').value,
                email: document.getElementById('new-email').value,
                role: document.getElementById('new-role').value,
                nip: document.getElementById('new-nip').value
            })
            .eq('id', userId);

        if (updateError) {
            alert("Gagal update: " + updateError.message);
        } else {
            alert("Data berhasil diperbarui!");
            closeUserModal();
            loadAdminUsers();
            form.onsubmit = handleAddUser; 
        }
    };

    openUserModal();
}

function openUserModal() {
    const modal = document.getElementById('user-modal');
    if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
}

function closeUserModal() {
    const modal = document.getElementById('user-modal');
    if (modal) { modal.classList.remove('flex'); modal.classList.add('hidden'); }
    
    const passParent = document.getElementById('new-password').parentElement;
    if (passParent) passParent.classList.remove('hidden');
    
    const form = document.getElementById('add-user-form');
    if (form) {
        form.reset();
        form.onsubmit = handleAddUser;
    }
}

async function handleAddUser(e) {
    e.preventDefault();
    const name = document.getElementById('new-name').value;
    const nip = document.getElementById('new-nip').value;
    const email = document.getElementById('new-email').value;
    const password = document.getElementById('new-password').value;
    const role = document.getElementById('new-role').value;

    const { data, error: authError } = await supabaseClient.auth.signUp({
        email: email,
        password: password,
        options: {
            data: { full_name: name, nip: nip, role: role }
        }
    });

    if (authError) {
        alert('Gagal mendaftarkan pengguna: ' + authError.message);
        return;
    }

    alert('Pengguna baru berhasil ditambahkan dan otomatis tersinkronisasi!');
    closeUserModal();
    const form = document.getElementById('add-user-form');
    if (form) form.reset();
    await loadAdminUsers();
}

async function deleteUser(userId) {
    if (!confirm('Apakah Anda yakin ingin menghapus pengguna ini dari tabel profil?')) return;
    const { error } = await supabaseClient.from('profiles').delete().eq('id', userId);
    
    if (error) alert('Gagal menghapus pengguna: ' + error.message);
    else {
        alert('Pengguna berhasil dihapus.');
        await loadAdminUsers();
    }
}

function formatDateID(dateStr) {
    if (!dateStr) return '-';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}
