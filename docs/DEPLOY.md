# EC2 배포 가이드 (Cloudflare Tunnel)

정적 파일 서버를 systemd로 돌리고, Cloudflare named tunnel로 HTTPS URL을 붙인다.
Docker 불필요 — 빌드도 런타임 의존성도 없는 정적 파일이다.

## 아키텍처

```
브라우저 ── https://relay.<도메인> ──> Cloudflare (TLS 종료)
                                        │ 터널 (cloudflared가 아웃바운드로 연결)
                                        ▼
                              EC2 127.0.0.1:8787 (http-server)
```

- 마이크(`getUserMedia`)는 HTTPS에서만 작동한다 → 반드시 터널 URL로 접속.
- 8787은 `127.0.0.1`에만 바인딩한다 → EC2 보안 그룹에서 포트를 열 필요 없음.
- quick tunnel(trycloudflare.com)은 재시작마다 URL이 바뀌어 OAuth가 깨진다 → **named tunnel 필수**.

## 1. 코드 받기

```bash
git clone https://github.com/Junwan8692/live-translate.git ~/live-translate
```

## 2. 정적 서버 (systemd)

```bash
sudo npm i -g http-server   # node가 없으면 nodejs 먼저 설치
```

`/etc/systemd/system/relay-web.service`:

```ini
[Unit]
Description=Relay static server
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/live-translate
ExecStart=/usr/bin/env http-server -p 8787 -a 127.0.0.1 -c-1
Restart=always

[Install]
WantedBy=multi-user.target
```

(User/경로는 실제 계정에 맞게. node 설치가 싫으면 ExecStart를
`/usr/bin/python3 -m http.server 8787 --bind 127.0.0.1`로 대체해도 된다.)

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now relay-web
curl -s http://127.0.0.1:8787/ | head -3   # <!doctype html> 나오면 OK
```

## 3. Cloudflare named tunnel

대시보드 관리형 터널이 가장 간단하다 (설정 파일 불필요, systemd 자동 등록):

1. Cloudflare 대시보드 → **Zero Trust → Networks → Tunnels → Create a tunnel** (Cloudflared 타입)
2. 이름 지정(예: `relay-ec2`) → 화면에 나오는 OS별 설치 명령 실행:
   `sudo cloudflared service install <토큰>` (cloudflared 패키지 설치 명령도 같이 표시됨)
3. **Public Hostname** 탭에서 추가:
   - Subdomain/Domain: `relay.<본인 도메인>`
   - Service: `HTTP` / `localhost:8787`
4. 확인: `systemctl status cloudflared` → active, 브라우저에서 `https://relay.<도메인>` 접속.

## 4. Cloudflare Access (로그인 벽)

서버에 API 키 파일(`js/env.local.js`)을 두려면 **필수** — 이게 없으면 정적 파일이라 방문자 전원에게 키가 노출된다.

1. Zero Trust 대시보드 → **Access → Applications → Add an application → Self-hosted**
2. Application name: `relay`, Session Duration: `1 month` (출장 중 재로그인 최소화)
3. Public hostname: `relay.<도메인>`, path는 비움 (사이트 전체 보호)
4. 정책 추가: Action `Allow`, Include → `Emails` 셀렉터에 팀원 이메일 나열
   (전원이 같은 회사 메일이면 `Email domain` 셀렉터로 도메인 한 줄이면 됨)
5. 로그인 방식: 기본값 **One-time PIN**(이메일 코드 입력, 설정 불필요) 또는 아래 Google 원클릭
6. 확인: 시크릿 창에서 `https://relay.<도메인>` 접속 → Access 로그인 화면이 먼저 떠야 정상

### (선택) PIN 없이 Google 원클릭 로그인

1. Google Cloud Console → Credentials → **OAuth client ID** (Web application) 생성
   - redirect URI: `https://<팀이름>.cloudflareaccess.com/cdn-cgi/access/callback`
     (`<팀이름>`은 Zero Trust → Settings → Custom Pages의 team domain)
   - consent screen은 조직 프로젝트면 Internal 권장
2. Zero Trust → **Settings → Authentication → Login methods → Add new → Google** → Client ID/Secret 입력 → Test
3. `relay` 애플리케이션에서 로그인 방식을 **Google만 선택** + **Instant Auth** 켜기
   → 접속 시 선택 화면 없이 바로 Google 계정 확인으로 통과

## 5. Supabase 리다이렉트 URL 등록

이거 안 하면 Google 로그인 후 리다이렉트가 실패한다.

- Supabase 대시보드 → **Authentication → URL Configuration**
- **Redirect URLs**에 `https://relay.<도메인>` 추가 (Site URL도 같은 값으로 설정 권장)

## 6. Gemini API 키

**Access(4번)를 켠 뒤에만** 서버에 키 파일을 만든다:

```bash
echo "export const GEMINI_KEY = '<키>';" > ~/live-translate/js/env.local.js
```

- Access 없이 이 파일을 만들면 방문자 전원에게 키가 노출된다 — **절대 금지**.
- gitignore된 파일이라 `git pull`과 충돌하지 않는다.
- 키에는 Google Cloud 콘솔에서 API 제한(Generative Language API만 허용)을 걸어둔다.
- Access 없이 배포한다면 이 파일을 만들지 말고 앱의 키 입력창을 사용한다 (localStorage, 기기당 1회).

## 업데이트

```bash
cd ~/live-translate && git pull
```

끝. 정적 서버는 매 요청마다 디스크를 읽으므로 재시작 불필요.

## 검증 체크리스트

- [ ] `systemctl status relay-web cloudflared` 둘 다 active
- [ ] 시크릿 창에서 접속 → Cloudflare Access 로그인 화면이 먼저 표시 (키 파일 보호 확인)
- [ ] 허용 목록에 없는 이메일 → 차단되는지 확인
- [ ] `https://relay.<도메인>` 접속 (로그인 후) → Relay 화면 표시
- [ ] Google 로그인 → 홈으로 정상 리다이렉트
- [ ] 세션 시작 → 마이크 권한 프롬프트 표시 → 번역 출력
- [ ] EC2 재부팅 후 위 항목 재확인 (자동 시작 검증)
