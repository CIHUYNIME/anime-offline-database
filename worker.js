const fs = require('fs');
const axios = require('axios');
const path = require('path');

const ANILIST_API_URL = 'https://graphql.anilist.co';
const DB_DIR = path.join(__dirname, 'database');

// File paths
const ALL_ANIME_FILE = path.join(DB_DIR, 'anime.json');
const EPISODE_BARU_FILE = path.join(DB_DIR, 'episode-baru.json');
const ONGOING_FILE = path.join(DB_DIR, 'ongoing.json');
const COMPLETED_FILE = path.join(DB_DIR, 'completed.json');
const UPCOMING_FILE = path.join(DB_DIR, 'upcoming.json');
const MOVIES_FILE = path.join(DB_DIR, 'movies.json');
const SYNC_FILE = path.join(DB_DIR, 'sync.json');

const PER_PAGE = 50;
const IS_FIRST_RUN = !fs.existsSync(ALL_ANIME_FILE);
const TOTAL_PAGES = IS_FIRST_RUN ? 100 : 20; 

if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

// Tambahkan field 'updatedAt' pada query
const query = `
query ($page: Int, $perPage: Int, $idIn: [Int], $status: MediaStatus) {
  Page(page: $page, perPage: $perPage) {
    media(type: ANIME, sort: [UPDATED_AT_DESC], id_in: $idIn, status: $status) {
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
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`Saved ${data.length} items to ${path.basename(filePath)}`);
}

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchAnilistAnimePage(page, extraVars = {}, retries = 3) {
    try {
        const response = await axios.post(ANILIST_API_URL, {
            query: query,
            variables: { page: page, perPage: PER_PAGE, ...extraVars }
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            }
        });

        if (response.data.errors) {
            console.error('GraphQL Errors:', response.data.errors);
            return [];
        }

        return response.data.data.Page.media;
    } catch (error) {
        if (error.response && error.response.status === 429 && retries > 0) {
            console.warn(`Rate limited (429) at page ${page}. Waiting 5 seconds to retry... (${retries} retries left)`);
            await delay(5000);
            return fetchAnilistAnimePage(page, extraVars, retries - 1);
        }
        console.error(`Anilist API request failed at page ${page}:`, error.response ? error.response.data : error.message);
        return [];
    }
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

async function main() {
    console.log('Starting AniList worker API Builder...');
    if (IS_FIRST_RUN) {
        console.log('First run detected! Fetching deep history...');
    }

    let allAnime = loadJSON(ALL_ANIME_FILE);
    let animeMap = new Map();
    allAnime.forEach((anime, index) => {
        animeMap.set(anime.id, index);
    });

    let syncData = loadJSON(SYNC_FILE);
    let lastSyncTime = syncData.last_updated_at || 0;
    let newHighestSyncTime = lastSyncTime;

    console.log(`Currently have ${allAnime.length} animes in master DB.`);
    console.log(`Last sync timestamp: ${lastSyncTime}`);

    let newlyFetchedCount = 0;
    let updatedCount = 0;
    let stopFetching = false;

    for (let page = 1; page <= TOTAL_PAGES; page++) {
        if (stopFetching) break;

        console.log(`Fetching page ${page} / ${TOTAL_PAGES}...`);
        const animes = await fetchAnilistAnimePage(page);
        
        if (animes.length === 0) {
            console.log("No more data or hit max errors. Stopping fetch loop early.");
            break;
        }

        for (const anime of animes) {
            // Track the absolute newest update time to save for next run
            if (anime.updatedAt > newHighestSyncTime) {
                newHighestSyncTime = anime.updatedAt;
            }

            // SMART SYNC LOGIC:
            // Jika kita menemukan anime yang terakhir diupdate lebih lama atau sama dengan waktu sync terakhir kita,
            // berarti semua data setelahnya di halaman ini (dan halaman berikutnya) sudah usang/tidak ada yang baru.
            if (!IS_FIRST_RUN && anime.updatedAt <= lastSyncTime) {
                console.log(`Found an anime that hasn't changed since last run (ID: ${anime.id}). Stopping fetch early to save resources!`);
                stopFetching = true;
                break;
            }

            const formatted = formatAnimeData(anime);

            if (animeMap.has(formatted.id)) {
                const index = animeMap.get(formatted.id);
                allAnime[index] = formatted;
                updatedCount++;
            } else {
                allAnime.push(formatted);
                animeMap.set(formatted.id, allAnime.length - 1);
                newlyFetchedCount++;
            }
        }

        if (page < TOTAL_PAGES && !stopFetching) {
            await delay(1500);
        }
    }

    console.log("Fetching currently releasing animes (musim ini)...");
    for (let page = 1; page <= 5; page++) {
        const animes = await fetchAnilistAnimePage(page, { status: "RELEASING" });
        if (animes.length === 0) break;
        
        for (const anime of animes) {
            const formatted = formatAnimeData(anime);
            if (animeMap.has(formatted.id)) {
                const index = animeMap.get(formatted.id);
                allAnime[index] = formatted;
                updatedCount++;
            } else {
                allAnime.push(formatted);
                animeMap.set(formatted.id, allAnime.length - 1);
                newlyFetchedCount++;
            }
        }
        await delay(1500);
    }

    console.log("Fetching specific missing anime IDs...");
    const missingAnimes = await fetchAnilistAnimePage(1, { idIn: [169580] });
    for (const anime of missingAnimes) {
        const formatted = formatAnimeData(anime);
        if (animeMap.has(formatted.id)) {
            const index = animeMap.get(formatted.id);
                allAnime[index] = formatted;
            updatedCount++;
        } else {
            allAnime.push(formatted);
            animeMap.set(formatted.id, allAnime.length - 1);
            newlyFetchedCount++;
        }
    }

    console.log(`Finished fetching. Added ${newlyFetchedCount} new animes, updated ${updatedCount} existing.`);

    // Sort allAnime by newest ID so latest animes are at the top
    allAnime.sort((a, b) => b.id - a.id);

    // Save Master DB
    saveJSON(ALL_ANIME_FILE, allAnime);

    // Save Sync Data
    saveJSON(SYNC_FILE, { last_updated_at: newHighestSyncTime });

    // 1. episode-baru.json (Pertahankan histori, jangan dihapus)
    let episodeBaru = loadJSON(EPISODE_BARU_FILE);
    let episodeBaruMap = new Map();
    episodeBaru.forEach((item, index) => {
        episodeBaruMap.set(item.id, index);
    });

    // Ambil anime yang sedang rilis dari master DB
    const releasingAnime = allAnime.filter(a => a.status === 'RELEASING' && a.next_airing_timestamp);
    
    releasingAnime.forEach(anime => {
        if (episodeBaruMap.has(anime.id)) {
            // Update data jika sudah ada di histori
            episodeBaru[episodeBaruMap.get(anime.id)] = anime;
        } else {
            // Tambahkan sebagai anime baru di histori
            episodeBaru.push(anime);
        }
    });

    // Urutkan: yang akan tayang terdekat di atas, yang sudah lewat/selesai ada di bawah sebagai histori
    episodeBaru.sort((a, b) => {
        const timeA = a.next_airing_timestamp || 9999999999;
        const timeB = b.next_airing_timestamp || 9999999999;
        return timeA - timeB;
    });

    saveJSON(EPISODE_BARU_FILE, episodeBaru);

    const ongoing = allAnime.filter(a => a.status === 'RELEASING');
    saveJSON(ONGOING_FILE, ongoing);

    const completed = allAnime.filter(a => a.status === 'FINISHED');
    saveJSON(COMPLETED_FILE, completed);

    const upcoming = allAnime.filter(a => a.status === 'NOT_YET_RELEASED');
    saveJSON(UPCOMING_FILE, upcoming);

    const movies = allAnime.filter(a => a.format === 'MOVIE');
    saveJSON(MOVIES_FILE, movies);

    console.log('API Generation Complete!');
}

main();
