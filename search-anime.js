const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'database', 'anime.json');

const args = process.argv.slice(2);
if (args.length === 0) {
    console.log("Harap masukkan ID anime. Contoh: node search-anime.js 169580");
    process.exit(1);
}

const searchId = parseInt(args[0]);
if (isNaN(searchId)) {
    console.log("ID harus berupa angka!");
    process.exit(1);
}

try {
    const rawData = fs.readFileSync(DB_FILE, 'utf8');
    const animeList = JSON.parse(rawData);
    
    const foundAnime = animeList.find(a => a.id === searchId);
    
    if (foundAnime) {
        console.log(`✅ Anime ditemukan!`);
        console.log(`- ID: ${foundAnime.id}`);
        console.log(`- Judul: ${foundAnime.title.romaji || foundAnime.title.english}`);
        console.log(`- Status: ${foundAnime.status}`);
        console.log(`- URL: ${foundAnime.url}`);
        console.log(`- Season: ${foundAnime.season} ${foundAnime.year}`);
    } else {
        console.log(`❌ Anime dengan ID ${searchId} TIDAK DITEMUKAN di database (anime.json).`);
    }
} catch (error) {
    console.error("Gagal membaca database:", error.message);
}
