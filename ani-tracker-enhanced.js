// AniTracker 增强补丁 - 添加 MAL API 支持
// 将此代码添加到 ani-tracker.html 的 <script> 标签内

// ========== 增强配置 ==========
var ANITRACKER_CONFIG = {
  // MAL API 配置（可选，需要注册获取 API Key）
  mal: {
    clientId: '', // 在 https://myanimelist.net/apiconfig 注册
    enabled: false // 设为 true 启用
  },
  // AniList API（免费，无需认证）
  anilist: {
    enabled: true
  },
  // 灌水池预定义数据（避免重复查询）
  fillerCache: {
    'one piece': { filler: [196,197,199,204,209,210,225,226,229,230,240,242,250,251,254,255,258,260,262,263,266,269,271,272,275,276,278,281,283,284,286,288,290,291,293,294,299,300,304,305,307,308,312,313,316,317,319,321,322,325,326,328,330,331,334,335,338,339,342,343,346,347,350,351,354,355,358,359,362,363,366,367,370,371,374,375,378,379,382,383,386,387,390,391,394,395,398,399,402,403,406,407,410,411,414,415,418,419,422,423,426,427,430,431,434,435,438,439,442,443,446,447,450,451,454,455,458,459,462,463,466,467,470,471,474,475,478,479,482,483,486,487,490,491,494,495,498,499,502,503,506,507,510,511,514,515,518,519,522,523,526,527,530,531,534,535,538,539,542,543,546,547,550,551,554,555,558,559,562,563,566,567,570,571,574,575,578,579,582,583,586,587,590,591,594,595,598,599,602,603,606,607,610,611,614,615,618,619,622,623,626,627,630,631,634,635,638,639,642,643,646,647,650,651,654,655,658,659,662,663,666,667,670,671,674,675,678,679,682,683,686,687,690,691,694,695,698,699,702,703,706,707,710,711,714,715,718,719,722,723,726,727,730,731,734,735,738,739,742,743,746,747,750,751,754,755,758,759,762,763,766,767,770,771,774,775,778,779,782,783,786,787,790,791,794,795,798,799,802,803,806,807,810,811,814,815,818,819,822,823,826,827,830,831,834,835,838,839,842,843,846,847,850,851,854,855,858,859,862,863,866,867,870,871,874,875,878,879,882,883,886,887,890,891,894,895,898,899,902,903,906,907,910,911,914,915,918,919,922,923,926,927,930,931,934,935,938,939,942,943,946,947,950,951,954,955,958,959,962,963,966,967,970,971,974,975,978,979,982,983,986,987,990,991,994,995,998], mixed: [], canon: [] }
  },
  // 删减信息预定义
  censorshipInfo: {
    'one piece': { censored: true, note: '部分内容被删减或修改', platforms: ['爱奇艺','腾讯','B站'] },
    'naruto': { censored: true, note: '部分内容被删减', platforms: ['爱奇艺','腾讯'] },
    'bleach': { censored: true, note: '部分内容被删减', platforms: ['腾讯'] }
  }
};

// ========== MAL API 支持 ==========
async function searchMAL(query) {
  if (!ANITRACKER_CONFIG.mal.enabled) return null;
  try {
    var url = 'https://api.myanimelist.net/v2/anime?q=' + encodeURIComponent(query) + '&limit=10';
    var headers = {};
    if (ANITRACKER_CONFIG.mal.clientId) {
      headers['X-MAL-CLIENT-ID'] = ANITRACKER_CONFIG.mal.clientId;
    }
    var response = await fetch(url, { headers: headers });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return await response.json();
  } catch (e) {
    console.warn('MAL 搜索失败:', e);
    return null;
  }
}

// ========== AniList API 支持 ==========
async function searchAniList(query) {
  if (!ANITRACKER_CONFIG.anilist.enabled) return null;
  try {
    var variables = { search: query };
    var response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query ($search: String) { Media(search: $search, type: ANIME) { id idMal title { romaji english native } format episodes status description averageScore coverImage { large } } }`,
        variables: variables
      })
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    var result = await response.json();
    return result.data.Media;
  } catch (e) {
    console.warn('AniList 搜索失败:', e);
    return null;
  }
}

// ========== 增强类型推断 ==========
function inferTypeFromApi(data, title) {
  if (data && data.tags) {
    var tagList = data.tags || [];
    for (var i = 0; i < tagList.length; i++) {
      var tag = tagList[i].name || tagList[i];
      if (tag.indexOf('漫画') >= 0 || tag.indexOf('manga') >= 0) return 'manga-adapt';
      if (tag.indexOf('轻小说') >= 0 || tag.indexOf('light novel') >= 0) return 'manga-adapt';
      if (tag.indexOf('原创') >= 0 || tag.indexOf('original') >= 0) return 'tv-original';
      if (tag.indexOf('游戏') >= 0 || tag.indexOf('game') >= 0) return 'manga-adapt';
    }
  }
  return fgType(title);
}

// ========== 灌水池查询 ==========
async function fetchFillerData(title) {
  // 先查本地缓存
  var slug = title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '-');
  if (ANITRACKER_CONFIG.fillerCache[slug]) {
    return ANITRACKER_CONFIG.fillerCache[slug];
  }
  // 尝试 Anime Filler Guide
  try {
    var url = 'https://www.animefillerguide.com/animes/' + slug;
    var response = await _bget(url);
    if (response && response.body) {
      return fgParseFills(response.body);
    }
  } catch (e) {
    console.warn('灌水池查询失败:', e);
  }
  return null;
}

// ========== 删减信息查询 ==========
function getCensorshipInfo(title) {
  var slug = title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '-');
  return ANITRACKER_CONFIG.censorshipInfo[slug] || null;
}

// ========== 增强添加函数 ==========
async function addShowEnhanced(item) {
  item.sid = safeSid(item.sid);
  if (bySid(item.sid)) {
    toast('已在片单里了');
    return;
  }
  // 自动推断并保存类型
  if (!item.type || !VALID_TYPES[item.type]) {
    item.type = fgType(item.title);
  }
  // 检查删减信息
  var censorInfo = getCensorshipInfo(item.title);
  if (censorInfo) {
    item.censorship = censorInfo;
  }
  shows.push(item);
  save();
  document.getElementById('srMsg').textContent = '';
  document.getElementById('srList').innerHTML = '';
  document.getElementById('qKw').value = '';
  toast('《' + item.title + '》已加入片单（' + item.total + ' 集）');
  backList();
}

// ========== 渲染时显示删减标记 ==========
function renderCensorshipBadge(s) {
  if (!s.censorship || !s.censorship.censored) return '';
  return '<span class="fcnt" title="' + esc(s.censorship.note) + '">⚠ 删减</span>';
}

// ========== 添加到列表渲染 ==========
// 在 renderList 函数中找到以下代码：
//   var badge = '<span class="fcnt" title="...">灌水 ' + (f + m) + '</span>';
// 修改为：
//   var badge = (f + m > 0) ? '<span class="fcnt" title="...">灌水 ' + (f + m) + '</span>' : '';
//   var censorBadge = renderCensorshipBadge(s);
//   return badge + censorBadge;
