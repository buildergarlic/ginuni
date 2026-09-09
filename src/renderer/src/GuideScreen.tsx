import { useState } from 'react'
import { ArrowLeft20Regular } from '@fluentui/react-icons'
import './guide.css'

const contents = [
  ['start', '바로 시작하기'], ['edit', '듣고 쓰기'], ['check', '확인하고 저장'],
  ['extras', '필요할 때만'], ['help', '막혔을 때']
] as const

export function GuideScreen({ onBack, version }: { onBack: () => void; version: string }) {
  const [example, setExample] = useState<'dialogue' | 'description'>('dialogue')
  return <main className="info-page writer-guide">
    <button className="back-button" onClick={onBack}><ArrowLeft20Regular aria-hidden="true" />돌아가기</button>
    <div className="manual-shell">
      <header className="manual-hero">
        <div><span className="manual-edition">작가를 위한 안내서 · v{version}</span>
          <h1>GiNuNi 사용법</h1>
          <p className="manual-tagline">대사 정리는 함께, 화면해설은 작가님의 손으로.</p>
          <p>처음이라면 아래 세 걸음만 따라오세요.<br />복잡한 설정은 나중에 알아도 괜찮습니다.</p>
        </div>
        <div className="manual-notebook" aria-hidden="true"><span>오늘의 작업</span><b>듣고 ✓</b><b>쓰고 ✓</b><b>확인하고 ✓</b><i>한 편씩, 차근차근.</i></div>
      </header>
      <nav className="manual-nav" aria-label="사용법 목차">{contents.map(([id, label], index) => <a key={id} href={`#guide-${id}`}><span aria-hidden="true">0{index + 1}</span>{label}</a>)}</nav>
      <aside className="manual-callout"><strong>먼저, 짧은 시험 영상으로 연습해 보세요.</strong><p>이 버전은 파일럿 베타입니다. 중요한 대본은 따로 백업하고, 완성 파일도 한컴오피스에서 직접 확인하세요. AI 초안과 자동 점검은 내용의 정확도를 보증하지 않습니다.</p></aside>

      <section className="manual-section" aria-labelledby="guide-start">
        <div className="manual-heading"><span>01</span><div><p>처음에는 이것만</p><h2 id="guide-start">세 걸음이면 작업 준비 끝</h2></div></div>
        <ol className="manual-steps">
          <li><span className="manual-number">1</span><h3>영상을 넣어요</h3><p><b>새 프로젝트 만들기</b>를 누르고, <b>내 컴퓨터 파일</b> 또는 <b>유튜브 링크</b>를 선택하세요.</p><p>영상 사용 권리를 확인한 뒤 <b>프로젝트 만들기</b>를 누릅니다.</p><span className="manual-caption">준비물: 사용 권한이 있는 3시간 이하 영상</span></li>
          <li><span className="manual-number">2</span><h3>대사 초안을 받아요</h3><p>프로젝트 화면에서 <b>로컬 음성 분석 시작</b>을 누르세요. 기본은 <b>내 PC에서 분석</b>입니다.</p><p>첫 사용에는 분석에 필요한 자료를 한 번 내려받습니다. API 키나 사용료는 필요 없습니다.</p><span className="manual-caption">처음 내려받기·유튜브 이용에는 인터넷 필요</span></li>
          <li><span className="manual-number">3</span><h3>듣고, 쓰고, 저장해요</h3><p>영상을 보며 대사를 고치고, 해설 칸에는 작가님이 직접 화면해설을 작성하세요.</p><p>대본 아래 <b>확인 완료 · 다음</b>으로 한 행씩 확인하고, 화면 위 <b>대본 내보내기 → HWPX 내보내기</b>로 저장합니다.</p><span className="manual-caption">문장을 고치는 것과 확인 완료는 별개예요</span></li>
        </ol>
        <details className="manual-detail"><summary>유튜브로 시작한다면?</summary><div><p>공개·일부공개 영상 주소를 붙여 넣으세요. 비공개·로그인 필요·실시간 방송·DRM 영상은 지원하지 않습니다.</p><p>프로젝트 제목을 비우면 분석 준비 중 영상 제목을 가져옵니다. 가져온 프로젝트 제목에서는 큰따옴표를 빼 줍니다.</p><div className="manual-title-example"><span>오늘의 “특별한” 이야기</span><span aria-hidden="true">→</span><strong>오늘의 특별한 이야기</strong></div><p>유튜브 재생과 음성 내려받기에는 인터넷이 필요합니다. 내 PC 분석을 선택해도 유튜브 접속 자체가 없어지는 것은 아닙니다.</p></div></details>
      </section>

      <section className="manual-section" aria-labelledby="guide-edit">
        <div className="manual-heading"><span>02</span><div><p>찾아보느라 시간을 쓰지 마세요</p><h2 id="guide-edit">오른쪽 문장을 누르면, 그 장면으로!</h2></div></div>
        <p>대사·해설 행이나 현재 편집 중인 내용 칸을 클릭하면 영상이 그 행의 <b>시작 시각</b>으로 이동합니다. 입력 중인 글은 유지되고, 일시정지 중이었다면 자동으로 재생하지 않습니다.</p>
        <div className="manual-demo" aria-label="대사와 해설 클릭 이동 연습">
          <div className="manual-demo-screen"><span>연습용 영상 표시</span><div className="manual-scene" aria-hidden="true"><i /><b /></div><output aria-live="polite">{example === 'dialogue' ? '00:12' : '00:18'} · 일시정지</output></div>
          <div className="manual-demo-script"><p><strong>아래 문장을 눌러 보세요</strong></p><button type="button" aria-pressed={example === 'dialogue'} onClick={() => setExample('dialogue')}><span>대사 · 00:12</span><strong>“어서 와. 기다리고 있었어.”</strong></button><button type="button" aria-pressed={example === 'description'} onClick={() => setExample('description')}><span>해설 · 00:18</span><strong>문을 열고 여자가 들어온다.</strong></button></div>
        </div>
        <p className="manual-caption">이 그림은 사용법 연습입니다. 실제 영상을 재생하거나 대본을 변경하지 않습니다.</p>
        <div className="manual-pair"><article><h3>대사는 귀로 확인</h3><p>들은 말과 초안이 다르면 직접 고치세요. 화자 표시가 있는 경우 이름도 확인합니다. 기본 내 PC 분석에는 화자 구분이 없습니다.</p><p>오른쪽 <b>대본 쓰기</b> 위쪽의 <b>글자 크기</b>에서 <b>+</b>, <b>−</b> 또는 막대를 움직이면 더 편하게 읽을 수 있어요.</p></article><article><h3>화면해설은 눈으로 보고 작성</h3><p>해설 후보 구간이 정말 해설을 넣어도 되는 시간인지 원음을 들어 보세요. 음악·효과음이나 놓친 대사가 있을 수 있습니다.</p><p><b>AI는 화면해설을 자동으로 쓰지 않습니다.</b> 장면을 판단하고 표현하는 일은 작가님의 몫입니다.</p></article></div>
        <p>방금 적용한 편집을 한 단계 되돌리려면 대본 아래 <b>실행 취소</b>를 누르세요. 되돌릴 편집이 있을 때 버튼을 사용할 수 있습니다.</p>
        <details className="manual-detail"><summary>시간 수정·줄 나누기·합치기는 어떻게 하나요?</summary><div><p>행을 선택하고 표에서 시작·종료 시간을 고치세요. <b>작업 도구 → 선택한 행 편집</b>의 <b>현재 위치를 시작으로</b>와 <b>현재 위치를 종료로</b>를 누르면 영상의 현재 위치를 사용할 수 있습니다.</p><p>예를 들어 1분 23초는 <b>01:23</b>입니다. 시작은 종료보다 빨라야 하고, 이웃 행과 시간이 겹치지 않아야 합니다.</p><p>행의 우클릭 메뉴에서 나누기·합치기·종류 변경·삭제를 할 수 있습니다. 나누기 전에는 재생 위치가 선택한 행 안에 있는지 확인하세요.</p></div></details>
      </section>

      <section className="manual-section" aria-labelledby="guide-check">
        <div className="manual-heading"><span>03</span><div><p>마지막 확인도 작가님이</p><h2 id="guide-check">확인 도장을 찍고, 대본을 꺼내요</h2></div></div>
        <ol className="manual-check-flow"><li><strong>다음 확인할 행</strong><span>확인 표시 없이 남은 곳으로 이동</span></li><li><strong>영상과 대본 대조</strong><span>대사·해설·시간 확인</span></li><li><strong>확인 완료 · 다음</strong><span>현재 행을 저장·확인한 뒤 다음 구간으로 이동</span></li></ol>
        <p>대본 아래 <b>확인 완료 · 다음</b>은 현재 행의 수정 내용을 저장하고, 그 행에 확인 완료 표시를 남깁니다. 이어서 아직 확인하지 않은 다음 행으로 이동하니, 그 행도 영상을 보며 확인하세요. 남은 행이 없으면 <b>모든 행을 확인했어요</b>라고 표시됩니다.</p>
        <aside className="manual-callout"><strong>나중에 확인할 곳으로 넘어가려면?</strong><p><b>다음 확인할 행</b>을 누르세요. 아직 확인하지 않은 행으로 이동하며, 현재 행에 확인 완료 표시를 남기지는 않습니다.</p></aside>
        <p>확인 완료한 행도 다시 수정하면 확인 전으로 돌아갑니다. 실수가 아니라 <b>수정한 내용을 한 번 더 살펴보라는 표시</b>예요.</p>
        <div className="manual-pair manual-exports"><article><span className="manual-file">HWPX</span><h3>화면해설 대본으로 저장</h3><p><b>대본 내보내기 → HWPX 내보내기</b> → 저장 폴더 선택.<br />대사와 작가가 쓴 해설을 문서로 꺼냅니다.</p><p>한컴오피스에서 문장을 읽고, 긴 문서의 페이지 나눔과 서식을 확인하세요.</p></article><article><span className="manual-file">SRT</span><h3>대사 자막으로 저장</h3><p><b>대본 내보내기 → SRT 내보내기</b> → 저장 폴더 선택.<br /><b>대사 행만</b> 들어갑니다. 해설 행은 포함되지 않습니다.</p><p>화면해설 대본이 필요하다면 HWPX를 선택하세요.</p></article></div>
        <p>같은 이름이 있으면 <b>V01 → V02 → V03</b>처럼 새 파일로 저장합니다. 기존에 내보낸 파일은 덮어쓰지 않습니다.</p>
        <aside className="manual-callout"><strong>자동 저장과 내보내기는 달라요.</strong><p>편집 후 <b>자동 저장됨</b> 표시를 확인하세요. 프로젝트는 첫 화면의 <b>최근 프로젝트</b>에서 이어 쓸 수 있습니다. 다른 사람에게 전달할 문서는 HWPX·SRT로 따로 내보내야 합니다.</p></aside>
        <p>시간·내용 오류는 먼저 고쳐야 내보낼 수 있습니다. 확인 전 행이 남았다면 검수를 계속하거나, 경고를 확인한 뒤 현재 내용을 작업용 파일로 저장할 수 있습니다. 작업용 파일을 최종 검수본으로 취급하지 마세요.</p>
      </section>

      <section className="manual-section" aria-labelledby="guide-extras">
        <div className="manual-heading"><span>04</span><div><p>기본 사용에 익숙해진 뒤</p><h2 id="guide-extras">필요한 도구만 하나씩 펼쳐요</h2></div></div>
        <p>화면 위 <b>작업 도구</b> 또는 영상 아래 <b>원문과 작업 기록</b>을 누르세요. 원문, 자동 점검 알림, 행 분할·병합, 사용 권리와 외부 전송 설정, 교정 제안, 이전 저장본과 작업 기록이 있습니다. 화자 표시가 있는 대본에서는 화자 이름도 바꿀 수 있습니다. <b>설정</b>·<b>About GiNuNi</b>·<b>개발자 후원</b>도 여기서 엽니다.</p>
        <details className="manual-detail"><summary>선택 사항 · AI에게 대사 교정 제안 받기 <span className="manual-cost">유료 · 외부 전송</span></summary><div><ol><li><b>작업 도구 → 설정</b>에서 OpenAI API 키를 저장한 뒤 <b>돌아가기</b>를 누릅니다. 키는 비밀번호처럼 다른 사람에게 공유하지 마세요.</li><li><b>작업 도구 → 사용 권리와 외부 전송 설정</b>에서 선택한 대사 텍스트 전송에 동의하고 <b>동의 설정 저장</b>을 누릅니다. 음성 전송 동의와는 별개입니다.</li><li>도구를 닫고 대사 한 행을 선택합니다. 다시 <b>작업 도구 → 선택한 대사 교정 제안 받기 · 선택 사항</b>을 열고 <b>선택한 대사 교정 요청 (유료)</b>를 누릅니다.</li><li>수정 전·제안·이유를 원음과 비교하고 <b>제안 적용</b> 또는 <b>제안 거절</b>을 선택합니다.</li></ol><p>선택한 대사 텍스트가 OpenAI로 전송되고 API 사용료가 발생합니다. AI가 뜻을 바꿀 수 있으므로 그대로 믿지 마세요. 적용 후에는 다시 확인해야 합니다.</p></div></details>
        <details className="manual-detail"><summary>이전 대본으로 되돌리고 싶어요</summary><div><p><b>작업 도구 → 이전 상태로 복구 → 이전 저장 목록 보기 → 복구할 저장본 선택 → 선택한 저장본으로 복구</b> 순서로 누르세요.</p><p>주요 작업 전 남겨 둔 최근 10개 복구본을 제공합니다. 모든 타이핑 순간이 남는 것은 아닙니다. 복구 직전 내용도 저장본으로 남지만, 영상 파일까지 백업하는 기능은 아닙니다.</p></div></details>
        <details className="manual-detail"><summary>목소리 구분·다른 음성 분석 방식을 쓰고 싶어요</summary><div><p>프로젝트를 만들 때 <b>고급 옵션 · 음성 분석 방식 변경</b>에서 선택합니다. 만든 뒤 분석을 시작하기 전에는 <b>로컬 음성 분석 시작</b> 옆 <b>고급 분석 옵션</b>에서 바꿀 수 있습니다. 처음에는 기본값을 유지해도 됩니다.</p><ul><li><b>내 PC에서 분석:</b> 대사 초안을 만듭니다. 음성 외부 전송과 API 사용료가 없습니다.</li><li><b>내 PC + 화자 분리:</b> 목소리를 구분하는 실험 기능입니다. 잘못 나뉜 화자는 직접 고치세요.</li><li><b>OpenAI로 분석:</b> API 키와 음성 외부 전송 동의가 필요하며 API 사용료가 발생합니다.</li></ul></div></details>
        <details className="manual-detail"><summary>어디를 고쳤는지 확인하고 싶어요</summary><div><p><b>작업 도구 → 선택한 행의 원래 음성 인식 결과</b>에서 초안을 비교하고, 같은 도구의 <b>작업 기록 · 고급 정보</b>에서 분석·수정·확인 기록을 살펴볼 수 있습니다.</p><p><b>작업 기록 파일 저장</b>으로 꺼낸 기록에는 대본 내용이 포함될 수 있습니다. 문의용 <b>진단 파일</b>과는 다르니 외부에 공유하기 전에 내용을 확인하세요.</p></div></details>
      </section>

      <section className="manual-section" aria-labelledby="guide-help">
        <div className="manual-heading"><span>05</span><div><p>잠깐 막혀도 괜찮아요</p><h2 id="guide-help">이럴 때는 이렇게 해 보세요</h2></div></div>
        <details className="manual-detail"><summary>저장 버튼을 누를 수 없어요</summary><div><p>HWPX·SRT 내보내기를 누를 수 없다면 대본 위 <b>시간 오류</b> 또는 <b>작업 도구 → 자동 점검 알림</b>에서 해당 행으로 이동하세요. 시작·종료 역전, 시간 겹침, 빈 내용 등을 수정합니다. 입력 중인 시간 값도 끝까지 완성해 주세요.</p><p>확인 전 행과 시간 오류는 달라요. 확인 전 행은 작업용 저장 경고가 나오지만, 잘못된 시간은 먼저 수정해야 합니다.</p></div></details>
        <details className="manual-detail"><summary>유튜브 영상이 안 나오거나 클릭 이동이 안 돼요</summary><div><p>인터넷 연결과 공개·일부공개 상태를 확인하고, 플레이어가 준비된 뒤 행을 다시 눌러 보세요. 일시정지 화면에서 시각만 바뀌었다면 정상입니다. 재생 버튼은 직접 눌러 주세요.</p><p>영상의 외부 재생 제한으로 앱 안에서 볼 수 없는 경우도 있습니다. 권한이 있는 원본 파일을 보유했다면 새 프로젝트에서 <b>내 컴퓨터 파일</b>로 작업할 수 있습니다. 제한을 우회하지 마세요.</p></div></details>
        <details className="manual-detail"><summary>분석이 실패했어요</summary><div><p>화면에 표시된 해결 방법부터 확인하세요. 처음 모델을 받는 중이라면 인터넷 연결을 확인하고, 손상 안내가 있으면 <b>로컬 모델 복구</b>를 사용합니다.</p><p>문제가 계속되면 <b>진단 파일 저장</b>으로 오류 정보를 모아 ABOUT의 연락처로 문의하세요. 영상·대본·API 키를 함께 보내지 마세요. 재분석은 시간이 걸리고, 외부 분석은 비용이 생길 수 있습니다.</p></div></details>
        <details className="manual-detail"><summary>예전 대본이 모두 확인 전으로 표시돼요</summary><div><p>이전 버전의 확인 기록을 새 방식으로 옮기면서 다시 확인하도록 표시할 수 있습니다. 대사와 해설이 사라진 것은 아닙니다. 원본 영상과 대조한 뒤 <b>확인 완료 · 다음</b>으로 표시하세요.</p></div></details>
        <details className="manual-detail"><summary>어디에 저장되나요? 업데이트는 어떻게 하나요?</summary><div><p>프로젝트는 Windows 문서 폴더의 <b>화면해설 대본 도구 → Projects</b>에 저장됩니다. 정확한 위치는 앱의 <b>설정</b>에서 확인하세요. 로컬 원본 영상은 작업 중 이동하거나 삭제하지 마세요.</p><p>첫 화면의 <b>About GiNuNi → 업데이트 확인</b>으로 새 버전을 확인합니다. 대본 작업 중에는 <b>작업 도구 → About GiNuNi</b>로 엽니다. 내려받기가 끝나면 <b>재시작하여 업데이트</b>를 누르세요. 설치 전 프로젝트와 원본 영상을 별도로 백업하는 것이 좋습니다.</p><p>무서명 파일럿은 Windows 경고가 나타날 수 있습니다. ABOUT의 GitHub 저장소에서 공식 Releases 출처를 확인하세요.</p></div></details>
      </section>
      <footer className="manual-footer"><strong>좋은 화면해설의 마지막 판단은, 언제나 작가님에게.</strong><p>GiNuNi는 반복 작업을 돕습니다. 표현과 정확성은 영상을 보며 직접 확인해 주세요.</p><a href="#guide-start">처음 단계 다시 보기 ↑</a></footer>
    </div>
  </main>
}
