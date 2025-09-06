import dotenv from "dotenv";
import admin from "firebase-admin";
import { createRequire } from "module";
dotenv.config();

const require = createRequire(import.meta.url);

// 1. 서비스 계정 키 파일과 DB 주소 설정
const serviceAccount = require(process.env.FIREBASE_AUTH_KEY_PATH);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`, // <-- 여기에 프로젝트 ID를 넣으세요.
});

// 2. 데이터 파일 불러오기
import data from "./data.json" with { type: "json" };
const db = admin.firestore();

// 데이터를 지정된 크기로 청크 단위로 나누는 함수
function chunkArray(array, chunkSize) {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

// 지연 함수 (rate limiting 방지용)
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function uploadData() {
  const collectionRef = db.collection(
    `${process.env.COLLECTION_NAME}`
  ); // <-- 데이터를 넣을 컬렉션 이름

  // 데이터를 500개씩 청크로 나누기 (Firestore batch 제한 고려)
  const BATCH_SIZE = 500;
  const dataChunks = chunkArray(data, BATCH_SIZE);

  console.log(
    `총 ${data.length}개의 데이터를 ${dataChunks.length}개의 배치로 나누어 업로드를 시작합니다...`
  );

  let totalProcessed = 0;
  let successfulBatches = 0;
  let failedBatches = 0;

  for (let chunkIndex = 0; chunkIndex < dataChunks.length; chunkIndex++) {
    const chunk = dataChunks[chunkIndex];
    const batch = db.batch();

    console.log(
      `\n배치 ${chunkIndex + 1}/${dataChunks.length} 처리 중... (${
        chunk.length
      }개 항목)`
    );

    // 현재 청크의 데이터를 배치에 추가
    chunk.forEach((docData, index) => {
      const docRef = collectionRef.doc();
      batch.set(docRef, {
        ...docData,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const globalIndex = totalProcessed + index + 1;
      console.log(`  ${globalIndex}번째 데이터 추가: ${docData.title}`);
    });

    try {
      // 배치 쓰기 실행
      await batch.commit();
      successfulBatches++;
      totalProcessed += chunk.length;
      console.log(
        `✅ 배치 ${chunkIndex + 1} 성공! (${chunk.length}개 업로드됨)`
      );

      // 마지막 배치가 아니면 잠시 대기 (rate limiting 방지)
      if (chunkIndex < dataChunks.length - 1) {
        console.log("다음 배치 처리를 위해 1초 대기 중...");
        await delay(1000);
      }
    } catch (error) {
      failedBatches++;
      console.error(`❌ 배치 ${chunkIndex + 1} 실패:`, error.message);

      // 개별 문서 처리 시도 (배치 실패 시 대안)
      console.log("개별 문서 업로드로 재시도 중...");
      let individualSuccess = 0;

      for (const docData of chunk) {
        try {
          const docRef = collectionRef.doc();
          await docRef.set({
            ...docData,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          individualSuccess++;
          totalProcessed++;
        } catch (individualError) {
          console.error(
            `개별 문서 업로드 실패: ${docData.title}`,
            individualError.message
          );
        }
      }

      console.log(
        `개별 처리 결과: ${individualSuccess}/${chunk.length}개 성공`
      );

      // 개별 처리 후에도 잠시 대기
      if (chunkIndex < dataChunks.length - 1) {
        await delay(2000); // 오류 후에는 더 긴 대기
      }
    }
  }

  // 최종 결과 출력
  console.log("\n📊 업로드 완료 결과:");
  console.log(`총 데이터: ${data.length}개`);
  console.log(`처리된 데이터: ${totalProcessed}개`);
  console.log(`성공한 배치: ${successfulBatches}/${dataChunks.length}`);
  console.log(`실패한 배치: ${failedBatches}/${dataChunks.length}`);

  if (totalProcessed === data.length) {
    console.log("🎉 모든 데이터가 성공적으로 Firestore에 업로드되었습니다!");
  } else {
    console.log(
      `⚠️  ${data.length - totalProcessed}개의 데이터 업로드에 실패했습니다.`
    );
  }
}

uploadData();
