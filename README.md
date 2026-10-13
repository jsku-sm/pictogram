# 픽토그램 수업 연구실

이 앱은 학생 화면과 서버 인증이 적용된 교사용 수식 화면으로 구성됩니다. 교사용 수식 데이터는 서버에서 생성되며, 유효한 교사 세션이 없으면 데이터 API가 `401`을 반환합니다.

## 실행

Node.js 20 이상이 필요합니다. 14자 이상의 교사용 비밀번호를 환경 변수로 설정한 뒤 서버를 실행하세요.

```sh
export TEACHER_PASSWORD="여기에_충분히_긴_비밀번호"
npm start
```

학생 화면은 `http://localhost:3000/`, 교사용 메뉴는 `http://localhost:3000/teacher`에서 엽니다. 학생 화면의 `교사용` 메뉴도 로그인 화면으로 연결됩니다. 로그인 세션은 8시간 후 만료됩니다.

## 배포

GitHub Pages는 정적 파일만 제공하므로 교사 인증 API를 실행할 수 없습니다. 저장소의 `render.yaml`을 이용해 Node 서버를 별도 배포하고, Pages의 교사용 메뉴는 그 서버로 연결합니다.

1. 변경 사항을 GitHub 저장소에 푸시합니다.
2. Render 대시보드에서 **New > Blueprint**를 선택하고 `jsku-sm/pictogram` 저장소를 연결합니다.
3. 서비스 `jsku-sm-pictogram-teacher`의 환경 변수 `TEACHER_PASSWORD`에 14자 이상의 강한 비밀번호를 설정하고 배포합니다.
4. 교사 페이지는 `https://jsku-sm-pictogram-teacher.onrender.com/teacher`에서 엽니다. 최초 배포가 끝나기 전에는 이 주소가 작동하지 않습니다.

Render는 HTTPS와 포트를 제공하며 설정 파일이 `HOST=0.0.0.0` 및 `NODE_ENV=production`을 지정합니다. `TEACHER_PASSWORD`는 플랫폼의 비밀 환경 변수로만 저장하고 코드, 저장소, 브라우저에 넣지 마세요. 로컬에서는 `npm start` 실행 시 기본 `http://localhost:3000/teacher` 경로를 사용합니다.

## 제공되는 수식

교사용 화면은 학생용과 같은 SVG 그림을 보이고, 각 그림 부분의 식을 나누어 표시합니다. 원은 원의 방정식, 직선은 양 끝 범위를 제한한 선분 방정식으로 제공됩니다. SVG `path`는 앱 원본 자체가 직선 좌표를 잇는 폴리라인이므로, 화면과 동일하도록 모든 선분을 각각 범위 제한 식으로 풀어 표시합니다. 부분별 또는 그림 전체 식을 복사할 수 있습니다.

## 검사

```sh
npm test
```
