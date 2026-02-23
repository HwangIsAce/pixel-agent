import { useRef, useEffect } from 'react'
import type { ReactNode } from 'react'

export interface DiaryLayoutProps {
  children: ReactNode
  /** Lines to show in the 일촌평 log area (oldest first). */
  logLines?: string[]
}

const diaryRootStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  background: 'repeating-conic-gradient(#e0e0e0 0% 25%, #e8e8e8 0% 50%) 50% / 14px 14px',
  padding: 20,
  boxSizing: 'border-box',
}

const diaryBorderStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'row',
  minHeight: 0,
  background: '#f8fafc',
  border: '6px solid #5a9fd4',
  borderRadius: 24,
  boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.4), 4px 6px 20px rgba(0,0,0,0.12)',
  overflow: 'hidden',
}

const leftColumnStyle: React.CSSProperties = {
  width: 200,
  minWidth: 200,
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  background: '#fff',
  borderRight: '1px solid #dde',
  padding: 12,
  boxSizing: 'border-box',
  gap: 10,
}

const profileImageStyle: React.CSSProperties = {
  width: '100%',
  aspectRatio: '1',
  objectFit: 'cover',
  borderRadius: 12,
  border: '2px solid #cce',
  background: '#eee',
}

const todayBarStyle: React.CSSProperties = {
  padding: '6px 10px',
  background: 'linear-gradient(90deg, #e8f0f8 0%, #f0f4f8 100%)',
  border: '1px solid #cce',
  borderRadius: 8,
  fontSize: 13,
  color: '#334',
}

const leftTextStyle: React.CSSProperties = {
  padding: 10,
  minHeight: 60,
  background: '#fafbfc',
  border: '1px solid #dde',
  borderRadius: 8,
  fontSize: 12,
  color: '#445',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
}

const separatorStyle: React.CSSProperties = {
  height: 1,
  background: '#ccd',
  margin: '4px 0',
}

const dropdownStyle: React.CSSProperties = {
  padding: '8px 12px',
  background: '#f0f4f8',
  border: '1px solid #bcd',
  borderRadius: 8,
  fontSize: 12,
  color: '#445',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
}

const rightColumnStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  padding: 12,
  gap: 8,
}

const pixelViewWrapperStyle: React.CSSProperties = {
  flex: 4,
  minHeight: 120,
  display: 'flex',
  flexDirection: 'column',
  border: '2px solid #aaa',
  borderRadius: 12,
  overflow: 'hidden',
  background: '#1e1e2e',
  boxShadow: 'inset 0 0 16px rgba(0,0,0,0.25), 1px 2px 6px rgba(0,0,0,0.15)',
}

const ilchonSectionStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 60,
  display: 'flex',
  flexDirection: 'column',
  background: '#fafbfc',
  border: '1px solid #dde',
  borderRadius: 10,
  overflow: 'hidden',
}

const ilchonTitleStyle: React.CSSProperties = {
  padding: '6px 10px',
  background: 'linear-gradient(90deg, #e8f0f8 0%, #f0f4f8 100%)',
  borderBottom: '1px solid #dde',
  fontSize: 12,
  fontWeight: 600,
  color: '#334',
}

const ilchonLogStyle: React.CSSProperties = {
  flex: 1,
  padding: 8,
  fontSize: 11,
  color: '#556',
  overflow: 'auto',
  fontFamily: 'monospace',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
}

const navBarStyle: React.CSSProperties = {
  width: 72,
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 10,
  background: 'linear-gradient(180deg, #e8f2f8 0%, #d8e8f4 100%)',
  borderLeft: '1px solid #bcd',
}

const navBtnStyle: React.CSSProperties = {
  padding: '8px 6px',
  background: '#7ab8e8',
  border: 'none',
  borderRadius: 12,
  color: '#fff',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
}

const NAV_ITEMS = ['프로필', '다이어리', '쥬크박스', '사진첩', '게시판', '동영상', '방명록'] as const

export function DiaryLayout({ children, logLines = [] }: DiaryLayoutProps) {
  const hasLogs = logLines.length > 0
  const logContent = hasLogs ? logLines.join('\n') : '(에이전트 동작 시 로그가 여기에 표시됩니다)'
  const ilchonLogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (logLines.length > 0 && ilchonLogRef.current) {
      ilchonLogRef.current.scrollTop = ilchonLogRef.current.scrollHeight
    }
  }, [logLines.length])

  return (
    <div style={diaryRootStyle}>
      <div style={diaryBorderStyle}>
        <div style={leftColumnStyle}>
          <div style={{ position: 'relative', width: '100%', aspectRatio: '1' }}>
            <img
              src={typeof window !== 'undefined' && (window as unknown as { __PROFILE_IMAGE_URI__?: string }).__PROFILE_IMAGE_URI__ || './assets/left-profile.png'}
              alt=""
              style={profileImageStyle}
              onError={(e) => {
                const el = e.target as HTMLImageElement
                el.style.display = 'none'
                const next = el.nextElementSibling as HTMLElement
                if (next) next.style.display = 'flex'
              }}
            />
            <div
              style={{
                display: 'none',
                position: 'absolute',
                inset: 0,
                background: '#e8ecf0',
                borderRadius: 12,
                border: '2px solid #cce',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                color: '#889',
              }}
            >
              프로필 사진
            </div>
          </div>
          <div style={todayBarStyle}>TODAY IS... ☔ 그리움</div>
          <div style={leftTextStyle}>{'나는... ㄱr끔... 눈물을... 흘린ㄷr...'}</div>
          <div style={separatorStyle} />
          <div style={dropdownStyle}>
            <span>▶ HISTORY</span>
            <span style={{ fontSize: 10 }}>▼</span>
          </div>
          <div style={dropdownStyle}>
            <span>★일촌 파도타기</span>
            <span style={{ fontSize: 10 }}>▼</span>
          </div>
        </div>

        <div style={rightColumnStyle}>
          <div style={pixelViewWrapperStyle}>
            {children}
          </div>
          <div style={ilchonSectionStyle}>
            <div style={ilchonTitleStyle}>일촌평 — Claude 로그</div>
            <div id="ilchon-log" ref={ilchonLogRef} style={ilchonLogStyle}>
              {logContent}
            </div>
          </div>
        </div>

        <div style={navBarStyle}>
          {NAV_ITEMS.map((label) => (
            <button key={label} type="button" style={navBtnStyle}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
