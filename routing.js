/* =========================================================
   길찾기 (OpenRouteService)
   - 카카오 SDK 에는 길찾기가 없어서 경로 계산만 외부 API 를 쓴다.
   - 받은 좌표는 카카오 지도 위에 Polyline 으로 그린다.
   ========================================================= */
import { ORS_API_KEY, ORS_BASE, ORS_PROFILES, TMAP_APP_KEY, TMAP_TRANSIT_URL } from "./config.js";

/**
 * 출발지 -> 도착지 경로를 구한다.
 * @param {"walk"|"car"} mode
 * @param {{lat:number, lng:number}} from
 * @param {{lat:number, lng:number}} to
 * @returns {Promise<{ok:true, distanceM:number, durationS:number, path:Array<{lat:number,lng:number}>}
 *                 | {ok:false, reason:"no-key"|"no-route"|"quota"|"network"|"bad-response"}>}
 */
export async function fetchRoute(mode, from, to){
  if(!ORS_API_KEY) return { ok:false, reason:"no-key" };

  const profile = ORS_PROFILES[mode];
  if(!profile) return { ok:false, reason:"bad-response" };

  const url = `${ORS_BASE}/${profile}`
    + `?api_key=${encodeURIComponent(ORS_API_KEY)}`
    + `&start=${from.lng},${from.lat}`
    + `&end=${to.lng},${to.lat}`;

  let res;
  try{
    res = await fetch(url);
  }catch(e){
    return { ok:false, reason:"network" };
  }

  if(res.status === 429) return { ok:false, reason:"quota" };
  if(!res.ok){
    // ORS 는 경로를 못 찾으면 404 + 오류 본문을 준다.
    return { ok:false, reason: res.status === 404 ? "no-route" : "bad-response" };
  }

  let json;
  try{
    json = await res.json();
  }catch(e){
    return { ok:false, reason:"bad-response" };
  }

  return parseRoute(json);
}

/** ORS GeoJSON 응답을 앱이 쓰는 형태로 바꾼다. (테스트에서 직접 호출한다) */
export function parseRoute(json){
  const feature = json && json.features && json.features[0];
  const summary = feature && feature.properties && feature.properties.summary;
  const coords = feature && feature.geometry && feature.geometry.coordinates;

  if(!summary || !Array.isArray(coords) || coords.length === 0){
    return { ok:false, reason:"no-route" };
  }

  return {
    ok: true,
    distanceM: Math.round(summary.distance),
    durationS: Math.round(summary.duration),
    // ORS 는 [경도, 위도] 순서, 카카오는 (위도, 경도) 순서라 뒤집는다.
    path: coords.map(([lng, lat]) => ({ lat, lng })),
  };
}

/** 소요시간을 "12분" / "1시간 5분" 형태로 만든다. */
export function formatDuration(seconds, t){
  const totalMin = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if(h === 0) return t.durMin(m);
  if(m === 0) return t.durHour(h);
  return `${t.durHour(h)} ${t.durMin(m)}`;
}

/** 거리를 "120m" / "1.4km" 형태로 만든다. */
export function formatDistance(meters){
  return meters < 1000 ? `${Math.round(meters)}m` : `${(meters/1000).toFixed(1)}km`;
}

/** 두 지점의 직선거리(m). 도보 거리 제한 안내를 띄울지 판단할 때 쓴다. */
export function straightDistanceM(a, b){
  const R = 6371000;
  const toRad = (d)=> d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat/2)**2
          + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng/2)**2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

/* =========================================================
   대중교통 (TMAP)
   - ORS 에는 대중교통이 없어서 이 수단만 TMAP 을 쓴다.
   - lang: 0 한국어, 1 영어. 한국어 UI 가 아니면 영어로 받는다.
   ========================================================= */

/**
 * @param {{lat:number,lng:number}} from
 * @param {{lat:number,lng:number}} to
 * @param {"ko"|"en"|"it"|"es"|"pt"} uiLang
 */
export async function fetchTransitRoute(from, to, uiLang){
  if(!TMAP_APP_KEY) return { ok:false, reason:"no-key" };

  let res;
  try{
    res = await fetch(TMAP_TRANSIT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", appKey: TMAP_APP_KEY },
      body: JSON.stringify({
        startX: String(from.lng), startY: String(from.lat),
        endX: String(to.lng), endY: String(to.lat),
        count: 1,
        format: "json",
        lang: uiLang === "ko" ? 0 : 1,
      }),
    });
  }catch(e){
    return { ok:false, reason:"network" };
  }

  if(res.status === 429) return { ok:false, reason:"quota" };
  if(!res.ok) return { ok:false, reason: res.status === 404 ? "no-route" : "bad-response" };

  let json;
  try{
    json = await res.json();
  }catch(e){
    return { ok:false, reason:"bad-response" };
  }
  return parseTransit(json);
}

/** TMAP 대중교통 응답을 앱이 쓰는 형태로 바꾼다. (테스트에서 직접 호출한다) */
export function parseTransit(json){
  // 출발지와 도착지가 너무 가깝거나 경로가 없으면 result.status 로 알려준다.
  const itinerary = json
    && json.metaData
    && json.metaData.plan
    && Array.isArray(json.metaData.plan.itineraries)
    && json.metaData.plan.itineraries[0];

  if(!itinerary || !Array.isArray(itinerary.legs)) return { ok:false, reason:"no-route" };

  const legs = itinerary.legs.map(leg=>({
    mode: leg.mode,                                   // WALK | BUS | SUBWAY | EXPRESSBUS ...
    name: legName(leg),
    from: leg.start && leg.start.name ? leg.start.name : "",
    to: leg.end && leg.end.name ? leg.end.name : "",
    sectionTimeS: Number(leg.sectionTime) || 0,
    color: leg.routeColor ? `#${String(leg.routeColor).replace(/^#/, "")}` : null,
    path: legPath(leg),
  }));

  return {
    ok: true,
    durationS: Math.round(Number(itinerary.totalTime) || 0),
    distanceM: Math.round(Number(itinerary.totalDistance) || 0),
    fare: itinerary.fare && itinerary.fare.regular ? Number(itinerary.fare.regular.totalFare) || 0 : 0,
    legs,
    // 지도에는 구간별로 선을 그린다 (도보는 회색, 버스·지하철은 노선 색)
    segments: legs.filter(l=> l.path.length > 1).map(l=>({
      path: l.path,
      color: l.mode === "WALK" ? "#8A8F96" : (l.color || "#1D3557"),
      dashed: l.mode === "WALK",
    })),
  };
}

/** 노선 이름: 버스·지하철은 노선명, 도보는 빈 값 */
function legName(leg){
  if(leg.mode === "WALK") return "";
  const route = leg.route ? String(leg.route).trim() : "";
  // "수도권1호선(급행)" 처럼 긴 이름이 와도 그대로 쓴다. 숫자만 오는 버스도 있다.
  return route || (leg.routeId ? String(leg.routeId) : "");
}

/** 구간 좌표: 버스·지하철은 passShape, 도보는 steps 의 linestring 을 잇는다 */
function legPath(leg){
  if(leg.passShape && leg.passShape.linestring) return parseLinestring(leg.passShape.linestring);
  if(Array.isArray(leg.steps)){
    return leg.steps.flatMap(st=> st && st.linestring ? parseLinestring(st.linestring) : []);
  }
  return [];
}

/** "127.02,37.63 127.03,37.64" -> [{lat,lng}, ...] (TMAP 도 경도,위도 순서) */
export function parseLinestring(str){
  return String(str).trim().split(/\s+/).map(pair=>{
    const [lng, lat] = pair.split(",").map(Number);
    return { lat, lng };
  }).filter(p=> Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

/** 수단 아이콘 (노선 요약 줄에 쓴다) */
export function modeIcon(mode){
  switch(mode){
    case "WALK": return "🚶";
    case "SUBWAY": return "🚇";
    case "BUS": return "🚌";
    case "EXPRESSBUS":
    case "AIRPLANE":
    case "TRAIN": return "🚆";
    default: return "➡️";
  }
}
