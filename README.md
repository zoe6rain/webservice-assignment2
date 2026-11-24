# 과제 2 신청 승인 서비스 - 업무 규칙과 트랜잭션

곽우현 (202446609) · 웹서비스설계 과제 2

학생이 행사에 신청하고 담당 운영자가 승인하는 서비스입니다. 시작 코드에 신청, 대기 취소, 승인, 승인 취소와 자동 승급, 변경 이력을 구현했습니다. 상태 변경과 이력 저장은 한 트랜잭션으로 묶어서 중간에 실패하면 전부 원래대로 돌아갑니다.

- 보고서: [docs/report.pdf](docs/report.pdf) (LMS에 낸 파일과 같은 버전)
- 검증 캡처: [docs/evidence/](docs/evidence/) (빨간·파란 박스를 넣은 캡처), 원본은 [docs/evidence/original/](docs/evidence/original/)
- API 계약: [docs/API.md](docs/API.md) (제공 문서, 수정하지 않음)

## 구현 완료 여부

| 항목 | 상태 |
|---|---|
| TODO-01 apply (신청 + APPLY 이력) | 완료 |
| TODO-02 cancel (본인 대기 취소 + CANCEL 이력) | 완료 |
| TODO-03 approve (담당자 직접 승인, 정원 검사 + APPROVE 이력) | 완료 |
| TODO-04 revoke (승인 취소, 대기자 1명 자동 승급, REVOKE·AUTO_APPROVE 이력 원인 연결) | 완료 |
| 모든 변경의 트랜잭션과 롤백 | 완료 |
| `npm test` (제공 기반 4개) | 4개 통과 |
| `npm run test:assignment` (필수 T01~T32) | 32개 통과 |
| `npm run test:advanced` (선택 심화, 서버 2개 동시 승인 20회) | 1개 통과 |
| 화면 검증 U01~U05 | 5개 모두 확인 (보고서 7장) |

테스트는 Windows, PowerShell 7.7.0, Node.js v24.21.0, npm 11.19.0 에서 실행했습니다.

## 변경한 파일

첫 커밋 `cfd5ac4` 가 받은 시작 코드 그대로이고, 그다음 커밋부터 제가 바꾼 부분입니다.

| 파일 | 변경 내용 |
|---|---|
| `src/application-service.js` | TODO 4개 구현, 트랜잭션 함수 `inTransaction`, 담당 운영자 확인 `findForManager`, 409 오류 두 개 추가 |
| `src/repository.js` | 다음 대기자를 찾는 `nextPending` 추가 |
| `.gitignore` | `.idea/` 한 줄 추가 |
| `README.md` | 이 문서로 바꿈 |
| `docs/report.pdf`, `docs/evidence/` | 보고서와 검증 캡처 추가 |

나머지 파일은 제공된 그대로이고 테스트도 바꾸지 않았습니다.

## 설치와 실행

Node.js 24.x 와 npm 이 필요합니다. Node.js 20, 22 는 지원하지 않습니다. 별도 DB 서버는 필요 없고 SQLite 는 Node 내장 모듈입니다.

```sh
git clone https://github.com/zoe6rain/webservice-assignment2.git
cd webservice-assignment2
node --version        # v24.x 확인
npm ci                # package-lock.json 기준으로 설치
npm test              # 제공 기반 테스트 4개
npm run test:assignment   # 필수 T01~T32
npm run test:advanced     # 선택 심화 (서버 2개 동시 승인 20회)
npm start
```

브라우저에서 http://127.0.0.1:3000 에 접속합니다. 종료는 `Ctrl + C` 입니다.

- 첫 실행 때 `data/app.sqlite` 와 `data/jwt-secret.txt` 가 자동으로 만들어집니다. 두 파일은 `.gitignore` 로 저장소에서 빠져 있습니다.
- 포트가 사용 중이면 Windows PowerShell 에서 `$env:PORT="3001"; npm start` 로 바꿔 실행합니다.
- 로그인 토큰은 브라우저 메모리에만 있어서 F5 를 누르면 다시 로그인해야 합니다. DB 데이터는 그대로 남습니다.

## DB 초기화

서버를 먼저 끄고 아래 명령을 실행한 뒤 `RESET` 을 입력합니다. 신청과 변경 이력이 지워지고 초기 계정과 행사가 다시 만들어집니다.

```sh
npm run db:reset
```

## 연습 계정

공통 비밀번호는 `Classroom123!` 입니다. 실제 이용자가 아닌 가상 계정입니다.

| 아이디 | 이름 | 역할 |
|---|---|---|
| alice | 민지 | 학생 |
| bob | 준호 | 학생 |
| charlie | 서연 | 학생 |
| manager1 | 운영자 A | 행사 1 담당, 정원 2명 |
| manager2 | 운영자 B | 행사 2 담당, 정원 1명 |

## 구현 요약

- 검사 순서는 대상 확인(404), 권한(403), 중복·상태(409), 정원(409) 입니다. 로그인(401)과 입력 형식(400)은 제공된 `src/app.js` 에서 먼저 처리합니다.
- 모든 변경은 `inTransaction` 안에서 처리합니다. `BEGIN IMMEDIATE` 로 시작해서 DB 의 최신 상태로 검사하고, 다 성공하면 `COMMIT`, 실패하면 `ROLLBACK` 합니다.
- 승인 취소는 대상 신청을 REVOKED 로 바꾸고 REVOKE 이력을 저장한 뒤, 같은 행사 대기자 중 먼저 신청한 1명을 승인하고 AUTO_APPROVE 이력을 저장합니다. 이 4개가 한 트랜잭션이고, AUTO_APPROVE 이력에는 원인으로 REVOKE 이력 ID 가 들어갑니다. 대기자가 없으면 `promoted` 는 `null` 입니다.
- 상태 전이도와 승인 취소 시퀀스 다이어그램은 보고서에 있습니다.

## 알려진 문제와 한계

- 서버 시작 메시지의 "TODO 구현 전 501입니다" 문구는 제공된 `src/server.js` 에 있는 문장이라 그대로 두었습니다. 실제로는 501 이 나오지 않습니다.
- 선택 심화 테스트는 20번 모두 통과했지만, 모든 동시 요청 상황에서 안전하다는 증명은 아닙니다. `BEGIN IMMEDIATE` 로 먼저 잠그는 방식이라 SQLite 파일 하나를 쓸 때만 해당합니다.
- 이력 저장 실패 시 롤백은 자동 테스트(T28~T30)로 확인했고, 실제 서버 화면에서 일부러 실패를 만들어 보지는 않았습니다.

## AI 사용

Claude 를 사용했습니다.

- `src/application-service.js`, `src/repository.js`: 트랜잭션 범위, 승인 취소의 롤백, 검사 순서, 자동 승급 정렬 기준을 물어보고, 설명과 예시 코드를 바탕으로 작성했습니다. 반영한 뒤 테스트와 화면 검증은 제 PC 에서 직접 실행해서 확인했습니다.
- 보고서의 상태 전이도와 승인 취소 시퀀스 다이어그램은 구현한 코드 흐름을 바탕으로 Claude 가 그렸고, 실제 코드와 맞는지 확인했습니다.
- README, 보고서 초안, 캡처의 빨간·파란 박스 표시에 사용했습니다. 원본 캡처는 `docs/evidence/original/` 에 있습니다.

## 참고 문서

- [Node.js SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)
- [SQLite 트랜잭션](https://www.sqlite.org/lang_transaction.html)
- [Express API](https://expressjs.com/en/5x/api/)
- 웹서비스설계 10주차(동기·비동기), 11주차(비즈니스 로직과 서비스 규칙 설계) 강의 자료
