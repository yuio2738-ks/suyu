/* =========================================================
   지도 · 검색 · 결과 렌더링
   ========================================================= */
import { KAKAO_APP_KEY, CATEGORIES, SEARCH_RADIUS_M, DEFAULT_CENTER, WALK_LIMIT_M } from "./config.js";
import { getLang, setLang, texts } from "./i18n.js";
import { fetchRoute, fetchTransitRoute, formatDuration, formatDistance, straightDistanceM, modeIcon } from "./routing.js";

let map, places, geocoder;
let centerLatLng = null;     // 현재 검색 기준 좌표 (kakao.maps.LatLng)
let markers = [];
let activeCategory = null;
let myLocationOverlay = null;
let myLatLng = null;         // 마지막으로 확인된 내 위치 (GPS)

// 길찾기 상태
let routeDest = null;        // { lat, lng, name }
let routeOrigin = null;      // { lat, lng, name, isMyLocation }
let routeModeId = "walk";
let routeLines = [];         // kakao.maps.Polyline (대중교통은 구간마다 하나씩)
let routeEndpoints = [];     // 출발/도착 마커
let lastRoute = null;        // 마지막 성공 결과 (언어 전환 시 재요청 없이 다시 그리기)
let pickingOrigin = false;

/* =========================================================
   3. 부트스트랩
   ========================================================= */
function checkKeyAndStart(){
  if(!KAKAO_APP_KEY || KAKAO_APP_KEY === "YOUR_KAKAO_JAVASCRIPT_KEY"){
    document.getElementById("setup").style.display = "flex";
    return;
  }
  const script = document.createElement("script");
  script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_APP_KEY}&libraries=services&autoload=false`;
  script.onload = () => kakao.maps.load(initMap);
  script.onerror = () => {
    document.getElementById("setup").style.display = "flex";
  };
  document.head.appendChild(script);
}

function initMap(){
  const container = document.getElementById("map");
  centerLatLng = new kakao.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
  map = new kakao.maps.Map(container, { center: centerLatLng, level: 5 });
  places = new kakao.maps.services.Places();

  buildChips();
  applyI18n();

  // GPS 위치를 시도해서 가능하면 그쪽으로 중심 이동
  if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition(
      (pos)=>{
        const ll = new kakao.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
        centerLatLng = ll;
        myLatLng = ll;
        map.setCenter(ll);
        placeMyLocationMarker(ll);
      },
      ()=>{ /* 권한 거부 시 기본 좌표 유지 */ },
      { enableHighAccuracy:true, timeout:5000 }
    );
  }

  document.getElementById("locateBtn").addEventListener("click", locateMe);
  document.getElementById("sheetHandle").addEventListener("click", toggleSheet);
  bindRouteUI();
}

function locateMe(){
  if(!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((pos)=>{
    const ll = new kakao.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
    centerLatLng = ll;
    myLatLng = ll;
    map.setCenter(ll);
    map.setLevel(4);
    placeMyLocationMarker(ll);
    if(activeCategory) runSearch(activeCategory);
  });
}

function placeMyLocationMarker(ll){
  if(myLocationOverlay) myLocationOverlay.setMap(null);
  const el = document.createElement("div");
  el.className = "pin me";
  el.innerHTML = `<span>●</span>`;
  myLocationOverlay = new kakao.maps.CustomOverlay({ position: ll, content: el, yAnchor: 0.5, zIndex: 10 });
  myLocationOverlay.setMap(map);
}

/* =========================================================
   4. 카테고리 칩 렌더링
   ========================================================= */
function buildChips(){
  const safetyRow = document.getElementById("chips-safety");
  const convRow = document.getElementById("chips-conv");
  CATEGORIES.forEach(cat=>{
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.dataset.id = cat.id;
    chip.innerHTML = `<span class="dot" style="background:${cat.color}"></span><span class="lbl">${cat.icon} ${texts()[cat.i18n]}</span>`;
    chip.addEventListener("click", ()=> selectCategory(cat));
    (cat.group === "safety" ? safetyRow : convRow).appendChild(chip);
  });
}

function refreshChipLabels(){
  document.querySelectorAll(".chip").forEach(chipEl=>{
    const cat = CATEGORIES.find(c=>c.id===chipEl.dataset.id);
    chipEl.querySelector(".lbl").textContent = `${cat.icon} ${texts()[cat.i18n]}`;
  });
}

function selectCategory(cat){
  if(routeDest) closeRoute();
  activeCategory = cat;
  document.querySelectorAll(".chip").forEach(el=>{
    const isActive = el.dataset.id === cat.id;
    el.classList.toggle("active", isActive);
    el.style.background = isActive ? cat.color : "";
  });
  document.getElementById("sheet").classList.add("expanded");
  runSearch(cat);
}

/* =========================================================
   5. 검색 (카테고리 / 키워드)
   ========================================================= */
function runSearch(cat){
  // 카테고리를 누른 시점의 "현재 지도 중심"을 기준으로 검색한다.
  // (지도를 드래그해서 다른 동네로 옮긴 뒤에도 그 위치 기준으로 검색되도록)
  centerLatLng = map.getCenter();
  const radius = cat.radius || SEARCH_RADIUS_M;
  const opts = { location: centerLatLng, radius: radius, sort: kakao.maps.services.SortBy.DISTANCE };
  const callback = (data, status)=> renderResults(cat, data, status);

  if(cat.type === "category"){
    places.categorySearch(cat.code, callback, opts);
  }else{
    places.keywordSearch(cat.keyword, callback, opts);
  }
}

function clearMarkers(){
  markers.forEach(m=>m.setMap(null));
  markers = [];
}

function fmtDistance(meters){
  const m = Number(meters);
  if(!m) return "";
  return m < 1000 ? `${m}m` : `${(m/1000).toFixed(1)}km`;
}

function appendBusFallback(list, cat, t){
  const c = centerLatLng;
  const fallback = document.createElement("div");
  fallback.className = "place";
  fallback.style.background = "#F4F0FF";
  fallback.style.cursor = "pointer";
  fallback.innerHTML = `
    <div class="badge" style="background:${cat.color}">${cat.icon}</div>
    <div class="info">
      <p class="pname">${t.busFallback}</p>
    </div>
  `;
  fallback.addEventListener("click", ()=>{
    window.open(`https://map.kakao.com/?map_type=TYPE_MAP&q=${encodeURIComponent(t.cat_bus)}&panelType=USERLOC&lat=${c.getLat()}&lng=${c.getLng()}`, "_blank", "noopener");
  });
  list.appendChild(fallback);
}

function renderResults(cat, data, status){
  clearMarkers();
  const list = document.getElementById("list");
  list.innerHTML = "";

  const t = texts();
  document.getElementById("sheetTitle").innerHTML = `<span class="dot" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${cat.color};margin-right:6px;"></span>${cat.icon} ${t[cat.i18n]}`;

  if(status !== kakao.maps.services.Status.OK || data.length === 0){
    document.getElementById("sheetCount").textContent = "";
    list.innerHTML = `<div class="empty">${t.noResults}</div>`;
    if(cat.id === "bus") appendBusFallback(list, cat, t);
    return;
  }

  document.getElementById("sheetCount").textContent = t.resultsFor(data.length);

  // 버스정류장은 카카오 검색 데이터가 부실해서, 카카오맵 앱으로 바로 연결되는 보완 링크를 항상 보여준다.
  if(cat.id === "bus") appendBusFallback(list, cat, t);

  const bounds = new kakao.maps.LatLngBounds();

  data.forEach((place, idx)=>{
    const pos = new kakao.maps.LatLng(place.y, place.x);
    bounds.extend(pos);

    // 마커
    const el = document.createElement("div");
    el.className = "pin";
    el.style.background = cat.color;
    el.innerHTML = `<span>${cat.icon}</span>`;
    const overlay = new kakao.maps.CustomOverlay({ position: pos, content: el, yAnchor: 1, zIndex: 3 });
    overlay.setMap(map);
    markers.push(overlay);

    el.addEventListener("click", ()=>{
      map.setCenter(pos);
      const row = document.getElementById(`place-${idx}`);
      if(row){
        row.scrollIntoView({ behavior:"smooth", block:"center" });
        row.classList.add("flash");
        setTimeout(()=>row.classList.remove("flash"), 1200);
      }
      document.getElementById("sheet").classList.add("expanded");
    });

    // 리스트 행
    const addr = place.road_address_name || place.address_name || "";
    const row = document.createElement("div");
    row.className = "place";
    row.id = `place-${idx}`;
    row.innerHTML = `
      <div class="badge" style="background:${cat.color}">${cat.icon}</div>
      <div class="info">
        <p class="pname">${escapeHtml(place.place_name)}</p>
        <p class="paddr">${escapeHtml(addr)}</p>
        <div class="actions">
          ${place.phone ? `<a href="tel:${place.phone}">📞 ${t.call}</a>` : ""}
          <button type="button" class="route-btn">🧭 ${t.directions}</button>
        </div>
      </div>
      <div class="dist">${fmtDistance(place.distance)}</div>
    `;
    row.addEventListener("click", ()=>{ map.setCenter(pos); map.setLevel(4); });
    row.querySelector(".route-btn").addEventListener("click", (e)=>{
      e.stopPropagation();
      openRoute({ lat:Number(place.y), lng:Number(place.x), name: place.place_name });
    });
    list.appendChild(row);
  });

  map.setBounds(bounds);
}

function escapeHtml(str){
  return String(str || "").replace(/[&<>"']/g, (c)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[c]));
}

function toggleSheet(){
  document.getElementById("sheet").classList.toggle("expanded");
}

/* =========================================================
   7. 길찾기
   - 경로 계산은 OpenRouteService, 표시는 카카오 지도 위 Polyline.
   ========================================================= */
function openRoute(dest){
  routeDest = dest;
  lastRoute = null;
  routeModeId = "walk";

  // 출발지 기본값: 마지막으로 확인된 내 위치. 없으면 사용자가 직접 정한다.
  routeOrigin = myLatLng
    ? { lat: myLatLng.getLat(), lng: myLatLng.getLng(), isMyLocation: true }
    : null;

  document.getElementById("list").hidden = true;
  document.getElementById("routeView").hidden = false;
  document.getElementById("sheet").classList.add("expanded");
  document.querySelectorAll(".route-modes .mode").forEach(b=>{
    b.classList.toggle("active", b.dataset.mode === routeModeId);
  });
  closeOriginSearch();
  renderRouteHeader();
  setSheetTitleForRoute();
  calcRoute();
}

// 길찾기 화면에서는 시트 머리말도 길찾기로 바꾼다 (카테고리 이름이 남아 있으면 헷갈린다)
function setSheetTitleForRoute(){
  document.getElementById("sheetTitle").textContent = `🧭 ${texts().routeTitle}`;
  document.getElementById("sheetCount").textContent = "";
}

function closeRoute(){
  clearRouteOverlays();
  routeDest = null; routeOrigin = null; lastRoute = null;
  stopPickingOrigin();
  closeOriginSearch();
  document.getElementById("routeView").hidden = true;
  document.getElementById("list").hidden = false;
  if(activeCategory) runSearch(activeCategory);   // 시트 머리말과 목록을 원래대로 되돌린다
}

function renderRouteHeader(){
  const t = texts();
  document.getElementById("routeDestName").textContent = routeDest ? routeDest.name : "";
  const originEl = document.getElementById("originName");
  if(!routeOrigin) originEl.textContent = "—";
  else originEl.textContent = routeOrigin.isMyLocation ? t.originMyLocation : routeOrigin.name;
}

function clearRouteOverlays(){
  routeLines.forEach(l=> l.setMap(null));
  routeLines = [];
  routeEndpoints.forEach(o=>o.setMap(null));
  routeEndpoints = [];
}

function routeMsg(text, kind){
  const t = texts();
  // 앱 안에서 길을 못 알려주는 상황에서만 카카오맵으로 넘기는 링크를 보여준다.
  const showFallback = (kind === "error" || kind === "warn") && routeDest;
  const kakaoLink = showFallback
    ? `<a href="https://map.kakao.com/link/to/${encodeURIComponent(routeDest.name)},${routeDest.lat},${routeDest.lng}" target="_blank" rel="noopener">🗺️ ${t.openInKakao}</a>`
    : "";
  document.getElementById("routeResult").innerHTML =
    `<div class="route-msg ${kind === "warn" ? "warn" : ""}">${escapeHtml(text)}${kakaoLink}</div>`;
}

async function calcRoute(){
  clearRouteOverlays();
  const t = texts();

  if(!routeDest) return;
  if(!routeOrigin){ routeMsg(t.needOrigin, "info"); return; }

  // 도보로 권하기 어려운 거리는 요청하지 않고 대중교통을 안내한다. (요청 낭비 방지)
  if(routeModeId === "walk" && straightDistanceM(routeOrigin, routeDest) > WALK_LIMIT_M){
    routeMsg(t.walkTooFar, "warn");
    return;
  }

  routeMsg(t.routing, "info");
  const res = routeModeId === "transit"
    ? await fetchTransitRoute(routeOrigin, routeDest, getLang())
    : await fetchRoute(routeModeId, routeOrigin, routeDest);

  if(!res.ok){
    const msg = {
      "no-key": t.errNoKey, "no-route": t.errNoRoute,
      quota: t.errQuota, network: t.errNetwork, "bad-response": t.errNoRoute,
    }[res.reason] || t.errNoRoute;
    lastRoute = null;
    routeMsg(msg, "error");
    return;
  }

  lastRoute = res;
  drawRoute(res);
  renderRouteSummary(res);
}

function renderRouteSummary(res){
  const t = texts();
  document.getElementById("routeResult").innerHTML = `
    <div class="route-summary">
      <span class="dur">${escapeHtml(formatDuration(res.durationS, t))}</span>
      <span class="dist">${escapeHtml(formatDistance(res.distanceM))}</span>
    </div>
    ${res.legs ? renderLegs(res, t) : ""}`;
}

/* 대중교통 노선 요약: 🚶 5분 · 🚇 4호선 수유 → 혜화 · 🚶 3분 */
function renderLegs(res, t){
  const chips = res.legs.map(leg=>{
    const mins = Math.max(1, Math.round(leg.sectionTimeS / 60));
    if(leg.mode === "WALK"){
      return `<span class="leg">${modeIcon(leg.mode)} ${escapeHtml(t.legWalk)} ${escapeHtml(t.durMin(mins))}</span>`;
    }
    const dot = leg.color ? `<span class="line" style="background:${escapeHtml(leg.color)}"></span>` : "";
    const stops = leg.from && leg.to
      ? `<span class="stop">${escapeHtml(leg.from)} → ${escapeHtml(leg.to)}</span>` : "";
    return `<span class="leg">${dot}${modeIcon(leg.mode)} ${escapeHtml(leg.name)} ${stops}</span>`;
  }).join('<span class="sep">·</span>');

  const fare = res.fare
    ? `<div class="route-fare">${escapeHtml(t.fareLabel)} ${escapeHtml(t.fareWon(res.fare))}</div>` : "";
  return `<div class="route-legs">${chips}</div>${fare}`;
}

function drawRoute(res){
  clearRouteOverlays();

  // 도보·자동차는 구간 하나, 대중교통은 환승 구간마다 색이 다르다.
  const segments = res.segments
    || [{ path: res.path, color: "#1D3557", dashed: false }];

  const bounds = new kakao.maps.LatLngBounds();
  segments.forEach(seg=>{
    const path = seg.path.map(p=> new kakao.maps.LatLng(p.lat, p.lng));
    path.forEach(ll=> bounds.extend(ll));
    const line = new kakao.maps.Polyline({
      path,
      strokeWeight: 5,
      strokeColor: seg.color,
      strokeOpacity: 0.85,
      strokeStyle: seg.dashed ? "shortdash" : "solid",
    });
    line.setMap(map);
    routeLines.push(line);
  });

  routeEndpoints = [
    endpointOverlay(routeOrigin, "#1D3557", "●"),
    endpointOverlay(routeDest, "#E63946", "★"),
  ];

  map.setBounds(bounds);
}

function endpointOverlay(point, color, glyph){
  const el = document.createElement("div");
  el.className = "pin me";
  el.style.background = color;
  el.innerHTML = `<span>${glyph}</span>`;
  const o = new kakao.maps.CustomOverlay({
    position: new kakao.maps.LatLng(point.lat, point.lng),
    content: el, yAnchor: 0.5, zIndex: 9,
  });
  o.setMap(map);
  return o;
}

/* ---- 출발지 지정: 지도 가운데 핀 ---- */
function startPickingOrigin(){
  pickingOrigin = true;
  document.getElementById("centerPin").hidden = false;
  document.getElementById("pickBar").hidden = false;
  document.getElementById("sheet").classList.remove("expanded");
}

function stopPickingOrigin(){
  pickingOrigin = false;
  document.getElementById("centerPin").hidden = true;
  document.getElementById("pickBar").hidden = true;
}

function confirmPickedOrigin(){
  const c = map.getCenter();
  routeOrigin = { lat: c.getLat(), lng: c.getLng(), name: texts().originPickOnMap, isMyLocation: false };
  stopPickingOrigin();
  document.getElementById("sheet").classList.add("expanded");
  renderRouteHeader();
  calcRoute();
}

/* ---- 출발지 지정: 장소 검색 (카카오 SDK 재사용) ---- */
function toggleOriginSearch(){
  const box = document.getElementById("originSearchBox");
  if(box.hidden){
    box.hidden = false;
    document.getElementById("originQuery").focus();
  }else{
    closeOriginSearch();
  }
}

function closeOriginSearch(){
  const box = document.getElementById("originSearchBox");
  box.hidden = true;
  document.getElementById("originQuery").value = "";
  document.getElementById("originResults").innerHTML = "";
}

function searchOrigin(query){
  if(!query.trim()) return;
  const t = texts();
  places.keywordSearch(query, (data, status)=>{
    const box = document.getElementById("originResults");
    box.innerHTML = "";
    if(status !== kakao.maps.services.Status.OK || data.length === 0){
      box.innerHTML = `<div class="hit">${t.searchNoResult}</div>`;
      return;
    }
    data.slice(0, 8).forEach(place=>{
      const hit = document.createElement("div");
      hit.className = "hit";
      hit.innerHTML = `${escapeHtml(place.place_name)}
        <span class="addr">${escapeHtml(place.road_address_name || place.address_name || "")}</span>`;
      hit.addEventListener("click", ()=>{
        routeOrigin = { lat:Number(place.y), lng:Number(place.x), name: place.place_name, isMyLocation:false };
        closeOriginSearch();
        renderRouteHeader();
        calcRoute();
      });
      box.appendChild(hit);
    });
  }, { location: map.getCenter(), sort: kakao.maps.services.SortBy.DISTANCE });
}

function bindRouteUI(){
  document.getElementById("routeBack").addEventListener("click", closeRoute);
  document.getElementById("originPickBtn").addEventListener("click", startPickingOrigin);
  document.getElementById("originSearchBtn").addEventListener("click", toggleOriginSearch);
  document.getElementById("pickConfirm").addEventListener("click", confirmPickedOrigin);
  document.getElementById("pickCancel").addEventListener("click", ()=>{
    stopPickingOrigin();
    document.getElementById("sheet").classList.add("expanded");
  });
  document.getElementById("originQuery").addEventListener("keydown", (e)=>{
    if(e.key === "Enter") searchOrigin(e.target.value);
  });
  document.querySelectorAll(".route-modes .mode").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      routeModeId = btn.dataset.mode;
      document.querySelectorAll(".route-modes .mode").forEach(b=> b.classList.toggle("active", b === btn));
      calcRoute();
    });
  });
}

/* =========================================================
   6. 다국어 적용
   ========================================================= */
function applyI18n(){
  document.documentElement.lang = getLang();
  document.querySelectorAll("[data-i18n]").forEach(el=>{
    const key = el.dataset.i18n;
    if(texts()[key]) el.textContent = texts()[key];
  });
  refreshChipLabels();
  if(activeCategory) runSearch(activeCategory); // 결과 리스트 라벨도 새로고침
  if(routeDest){
    renderRouteHeader();
    // runSearch 가 시트 머리말을 카테고리 이름으로 되돌리므로 그 뒤에 다시 쓴다
    setSheetTitleForRoute();
    if(lastRoute) renderRouteSummary(lastRoute); else calcRoute();
  }
}

document.querySelectorAll(".langs button").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    setLang(btn.dataset.lang);
    document.querySelectorAll(".langs button").forEach(b=>b.classList.toggle("active", b===btn));
    applyI18n();
  });
});

checkKeyAndStart();
