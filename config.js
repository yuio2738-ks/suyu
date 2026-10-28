/* =========================================================
   설정
   - KAKAO_APP_KEY: 카카오 JavaScript 키 (배포 도메인을 카카오 콘솔에 등록해야 동작)
   - CATEGORIES:    검색 카테고리 정의
   ========================================================= */
export const KAKAO_APP_KEY = "dabadca959ace60f5847cfd6878e98bd";

/* =========================================================
   2. 카테고리 정의
   - type "category": 카카오 카테고리 그룹 코드 검색
   - type "keyword"  : 카카오 키워드 검색 (코드가 없는 업종)
   ========================================================= */
export const CATEGORIES = [
  { id:"hospital",    group:"safety", type:"category", code:"HP8", color:"var(--c-hospital)",    icon:"🏥", i18n:"cat_hospital" },
  { id:"pharmacy",    group:"safety", type:"category", code:"PM9", color:"var(--c-pharmacy)",    icon:"💊", i18n:"cat_pharmacy" },
  { id:"police",      group:"safety", type:"keyword",  keyword:"파출소", color:"var(--c-police)", icon:"🚓", i18n:"cat_police" },
  { id:"fire",        group:"safety", type:"keyword",  keyword:"소방서", color:"var(--c-fire)",    icon:"🚒", i18n:"cat_fire" },
  { id:"convenience", group:"conv",   type:"category", code:"CS2", color:"var(--c-convenience)", icon:"🏪", i18n:"cat_convenience" },
  { id:"subway",      group:"conv",   type:"category", code:"SW8", color:"var(--c-subway)",      icon:"🚇", i18n:"cat_subway" },
  { id:"bus",         group:"conv",   type:"keyword",  keyword:"버스정류장", color:"var(--c-bus)", icon:"🚌", i18n:"cat_bus", radius:3000 },
  { id:"cathedral",   group:"conv",   type:"keyword",  keyword:"성당", color:"#9B5DE5", icon:"⛪", i18n:"cat_cathedral" },
];

export const SEARCH_RADIUS_M = 1500;
// 강북구청 부근 기본 좌표 (GPS 권한이 없을 때 사용)
export const DEFAULT_CENTER = { lat: 37.6397, lng: 127.0256 };

/* ---- 길찾기 (OpenRouteService) ----
   키는 openrouteservice.org 가입 후 발급. 도메인 제한이 없어 노출되면
   한도가 소진될 수 있으므로, 운영 키와 테스트 키를 따로 쓴다. */
export const ORS_API_KEY = "";
export const ORS_BASE = "https://api.openrouteservice.org/v2/directions";
export const ORS_PROFILES = { walk: "foot-walking", car: "driving-car" };

// 도보 경로를 권하지 않는 직선거리 기준 (초과 시 대중교통 안내)
export const WALK_LIMIT_M = 5000;

/* ---- 대중교통 (TMAP) ----
   키는 openapi.sk.com 가입 후 발급. ORS 와 마찬가지로 노출되므로
   테스트 키와 운영 키를 분리한다. */
export const TMAP_APP_KEY = "";
export const TMAP_TRANSIT_URL = "https://apis.openapi.sk.com/transit/routes";
