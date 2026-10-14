'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const destination=path.join(__dirname,'..','.env');
if (fs.existsSync(destination)) {
  console.error('.env가 이미 있습니다. 기존 설정은 덮어쓰지 않았습니다.');
  process.exit(1);
}
const password=crypto.randomBytes(21).toString('base64url');
fs.writeFileSync(destination,`TEACHER_USERNAME=teacher\nTEACHER_PASSWORD=${password}\n`,{flag:'wx',mode:0o600});
console.log('로컬 교사 계정을 만들었습니다. 아래 비밀번호를 개인적으로 보관하세요.');
console.log('아이디: teacher');
console.log(`비밀번호: ${password}`);
console.log('다음 명령: npm start');
console.log('.env 파일을 GitHub에 올리거나 학생에게 공유하지 마세요.');
