const fs = require('fs');
const axios = require('axios');
const path = require('path');
const readline = require('readline');

const ANILIST_API_URL = 'https://graphql.anilist.co';
const DB_DIR = path.join(__dirname, 'database');
const ALL_ANIME_FILE = path.join(DB_DIR, 'anime.json');

const query = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    idMal
    updatedAt
    title {
      english
      romaji
      native
    }
    description(asHtml: false)
    coverImage {
      extraLarge
      large
    }
    bannerImage
    seasonYear
    season
    format
    episodes
    duration
    status
    averageScore
    genres
    nextAiringEpisode {
      airingAt
      timeUntilAiring
      episode
    }
  }
}
`;

function loadJSON(filePath) {
    if (fs.existsSync(filePath)) {
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (e) {
            return [];
        }
    }
    return [];
}

function saveJSON(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function formatAnimeData(anime) {
    let timeString = '';
    let nextEpisode = null;
    let nextAiringAt = null;

    if (anime.nextAiringEpisode) {
        const airingDate = new Date(anime.nextAiringEpisode.airingAt * 1000);
        timeString = `Episode ${anime.nextAiringEpisode.episode} tayang pada ${airingDate.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`;
        nextEpisode = anime.nextAiringEpisode.episode;
        nextAiringAt = anime.nextAiringEpisode.airingAt;
    } else if (anime.season && anime.seasonYear) {
        timeString = `Musim: ${anime.season} ${anime.seasonYear}`;
    } else {
        timeString = 'Jadwal belum diketahui';
    }

    return {
        id: anime.id,
        id_mal: anime.idMal || null,
        url: `https://anilist.co/anime/${anime.id}`,
        title: {
            english: anime.title.english || '',
            romaji: anime.title.romaji || '',
            native: anime.title.native || ''
        },
        description: anime.description || 'Tidak ada deskripsi.',
        image_url: anime.coverImage.extraLarge || anime.coverImage.large || '',
        banner_url: anime.bannerImage || '',
        schedule: timeString,
        next_episode: nextEpisode,
        next_airing_timestamp: nextAiringAt,
        season: anime.season || '',
        year: anime.seasonYear || null,
        format: anime.format || '',
        episodes: anime.episodes || null,
        duration: anime.duration || null,
        status: anime.status || '',
        score: anime.averageScore || null,
        genres: anime.genres || [],
        updated_at: anime.updatedAt || 0
    };
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('masukan id anilist: ', async (answer) => {
    const id = parseInt(answer.trim());
    if (isNaN(id)) {
        console.log('ID harus berupa angka!');
        rl.close();
        return;
    }

    console.log(`Mengambil data anime dengan ID ${id}...`);
    try {
        const response = await axios.post(ANILIST_API_URL, {
            query: query,
            variables: { id: id }
        });

        if (response.data.errors) {
            console.log('Error dari AniList:', response.data.errors[0].message);
        } else {
            const animeData = response.data.data.Media;
            const formattedData = formatAnimeData(animeData);
            
            let allAnime = loadJSON(ALL_ANIME_FILE);
            
            const existingIndex = allAnime.findIndex(a => a.id === id);
            if (existingIndex !== -1) {
                console.log('Anime sudah ada di database. Memperbarui data...');
                allAnime[existingIndex] = formattedData;
            } else {
                console.log('Menambahkan anime baru ke atas list...');
                allAnime.unshift(formattedData);
            }
            
            // Urutkan ulang berdasarkan ID terbaru agar selalu di paling atas (sama seperti worker)
            allAnime.sort((a, b) => b.id - a.id);
            
            saveJSON(ALL_ANIME_FILE, allAnime);
            console.log(`Berhasil menyimpan ${formattedData.title.romaji || formattedData.title.english}!`);
            console.log('Jalankan `node worker.js` kembali jika ingin mengupdate file ongoing.json dll secara sinkron.');
        }
    } catch (error) {
        console.error('Gagal mengambil data:', error.message);
    }
    
    rl.close();
});
