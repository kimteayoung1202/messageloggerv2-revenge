# 0.5.7 user-requested extensions

Hidden rows now use one large lock instead of the channel-type icon. Tapping opens a native metadata alert and a View anyway button. That button calls the original internal route function for the selected channel, while hidden fetches and the locked message screen stay guarded. Original placement and read state remain; ordinary rows retain the native renderer. This intentionally extends the pinned upstream behavior. Android UI/navigation remain unverified.

# Hidden Channels Fix 모바일 이식 — 0.5.5

기준: [cloudburst / Training Dummy 원본](https://github.com/trainingdummy/vendetta-plugins/tree/c473c13c1a5d7983d1fb45bda15fd19b14c21ead/plugins/hidden-channels), CC0 1.0.

원본의 표시용 VIEW_CHANNEL override, transitionToGuild/fetchMessages 차단, 기본 채널 행과 ChannelMessages 숨김 안내 화면을 Revenge 1.11.6에 맞게 연결합니다. 원본의 orig(args) 호출은 this와 원래 인자를 보존하도록 고쳤고, realCheck 임시 레코드 변경은 별도 실제 판정 함수로 바꿨습니다. 표시 판정이 CONNECT 등 다른 권한으로 전파되지 않도록 중첩 실제 판정도 보존합니다. 권한 뷰어는 표시용 override를 읽지 않습니다.

기본 행이 이름과 아이콘을 그립니다. 모든 서버에서 받은 숨김 채널을 원래 위치에 표시하고, 별도 읽지 않음 억제를 적용하지 않습니다. 기존 커스텀 행과 BD 옵션은 원본 모듈이 아직 발견되지 않을 때만 호환 경로로 사용합니다. All-in-One 기능 스위치·스트리머 모드·로거·권한 뷰어는 유지합니다. 숨김 안내 화면에는 원본의 주제/생성/마지막 메시지/핀 정보가 포함되며, 원본의 moment 상대 시각, 날짜 누르기 토스트, 길게 눌러 타임스탬프 복사도 연결합니다. moment가 없는 경우 절대 시각으로 대체합니다.

검증: 242개 자동 테스트. 네이티브 이름/아이콘 renderer 반환값, 실제 권한과 중첩 판정, 숨김 요청 차단, 일반 함수 호출, 늦은 연결, off/streamer/unload 캐시 재생성, 로거 저장을 모의 검증했습니다. 실제 Android 347012 화면의 기본 잠금 아이콘·굵기·미읽음 스타일 및 전체 UI 동등성은 검증하지 못했습니다.

---

이하 내용은 0.5.0–0.5.4 호환 경로의 기존 범위입니다.

# ShowHiddenChannels 모바일 구현 범위

기준: [JustOptimize/ShowHiddenChannels 6.12](https://github.com/JustOptimize/ShowHiddenChannels/tree/0426b6bc815491d1d1b0bd3475563ee3b32cea58), 특히 src/index.js, SettingsPanel.jsx, Lockscreen.jsx와 접근 역할 컴포넌트. 독립 구현이며 원본 소스는 배포물에 포함하지 않습니다.

| 원본 동작 | Revenge 구현 |
|---|---|
| 실제 VIEW_CHANNEL로 숨김 판정, DM/가상 경로 제외 | 실제 PermissionStore.can 판정을 유지 |
| 원래 카테고리에 숨김 채널 표시 | 복사한 ChannelList 모델의 renderLevel 조정 |
| native / bottom / extra 정렬 | 세 정렬, 별도 Hidden Channels 카테고리, 접기/펼치기와 섹션 번호 보정 |
| lock / eye / 아이콘 없음 | 모바일 행의 잠금/눈 아이콘/없음 |
| 종류별 표시, 서버 blacklist, 빈 카테고리 | 개별 설정, 서버별 설정 목록 |
| 읽지 않음과 멘션 숨김 | ReadStateStore 연결, MarkUnread 옵션 |
| 숨김 메시지 요청 차단, 음성 연결 제한 | fetchMessages 요청 제외, 숨김 행은 정보 화면만 열기; 실제 CONNECT 권한 유지 |
| 숨김 채널 잠금 화면 | 모바일 모달, 이름·주제·유형·생성/마지막 메시지 시각·슬로 모드·NSFW·비트레이트·포럼 태그·가이드라인 |
| 채널별 역할·관리자 역할·멤버 목록 | 채널별 접근 역할, 관리자 표시 옵션, 캐시된 멤버의 접근 계산 |
| Guild 메뉴 Disable SHC | 설정의 서버별 켜기/끄기 목록 |
| 설정 변경 및 unload 복원 | Flux 목록 갱신, 모든 패치/탐색 타이머 해제 |

모바일 차이: 실제 PermissionStore.can을 VIEW_CHANNEL=true로 바꾸지 않고 표시 모델을 복사합니다. 채널 레코드의 parent_id를 덮어쓰지 않습니다. 추가 카테고리는 가상 조회 레코드로 제공됩니다. 원본의 DOM/CSS 및 채팅 본문 잠금 화면은 React Native 행/모달로 대체합니다. 캐시되지 않은 멤버 프로필을 네트워크로 추가 요청하지 않으며 접근 여부를 확인 불가로 표시합니다. 데스크톱 파일 자동 업데이트, 프리릴리스 업데이트와 업데이트/후원 UI는 포함하지 않습니다. Revenge의 기존 설치 URL 업데이트를 사용합니다. 원본의 읽지 않음 설정 키 불일치(stopMarkingUnread/MarkUnread)와 문자열 false 처리 오류는 그대로 재현하지 않고 선택한 값이 실제 동작하도록 연결합니다.

검증: 총 228개 모의/자동 테스트. 이 가운데 채널·권한 모듈 18개와 all-in-one 통합 1개를 추가했고 기존 209개 메시지로거 테스트를 유지했습니다. BD 원본 전체를 직접 실행한 비교 테스트나 실제 Android 347012 화면/모듈 연결 검증은 수행하지 않았습니다.

API 근거: Revenge 1.11.6 1b1d297416594087769987908e5fc09af36b7e6e의 Metro findByFilePath/findByStoreName, Discord mobile datamining 6b4f87763b43cac7485c1e03ad70926dd350fb95의 ChannelListStore/ChannelListState/renderRedesignChannelListItem/RedesignChannelListConstants/ChannelRecord/ReadStateStore/CategoryCollapseStore. 메타데이터가 서버에서 제공되지 않으면 표시할 수 없습니다.
