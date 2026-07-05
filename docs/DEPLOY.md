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

## 4. Supabase 리다이렉트 URL 등록

이거 안 하면 Google 로그인 후 리다이렉트가 실패한다.

- Supabase 대시보드 → **Authentication → URL Configuration**
- **Redirect URLs**에 `https://relay.<도메인>` 추가 (Site URL도 같은 값으로 설정 권장)

## 5. Gemini API 키

서버에 `js/env.local.js`를 **만들지 말 것** — 정적 파일로 서빙되어 방문자 전원에게 키가 노출된다.
배포판에서는 앱이 띄우는 키 입력창을 사용한다 (localStorage 저장, 기기당 1회).

## 업데이트

```bash
cd ~/live-translate && git pull
```

끝. 정적 서버는 매 요청마다 디스크를 읽으므로 재시작 불필요.

## 검증 체크리스트

- [ ] `systemctl status relay-web cloudflared` 둘 다 active
- [ ] `https://relay.<도메인>` 접속 → Relay 화면 표시
- [ ] Google 로그인 → 홈으로 정상 리다이렉트
- [ ] 세션 시작 → 마이크 권한 프롬프트 표시 → 번역 출력
- [ ] EC2 재부팅 후 위 항목 재확인 (자동 시작 검증)
