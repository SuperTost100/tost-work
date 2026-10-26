/** The tost.one sprig drawings from the mockup, placed in free space beside the setup column. */
export function Sprigs() {
  return (
    <>
      <svg className="sprig left" viewBox="0 0 120 200" aria-hidden="true" style={{ left: 90, width: 96 }}>
        <path d="M60 200 C58 140 62 90 60 20" stroke="var(--ink)" strokeWidth="4" fill="none" />
        <path d="M60 60 C40 50 28 34 30 12 C52 16 62 36 60 60Z" fill="#B3A28B" />
        <path d="M60 110 C80 100 92 82 90 60 C68 66 58 86 60 110Z" fill="#CFC3AD" />
        <path d="M60 150 C42 142 32 128 33 110 C52 114 61 130 60 150Z" fill="#B3A28B" />
      </svg>
      <svg className="sprig right" viewBox="0 0 160 200" aria-hidden="true" style={{ right: 100, width: 130 }}>
        <path d="M20 200 C40 150 70 110 140 80" stroke="var(--ink)" strokeWidth="4" fill="none" />
        <path d="M62 132 C48 112 46 88 58 66 C74 86 74 112 62 132Z" fill="#CFC3AD" />
        <path d="M96 104 C88 82 92 60 108 44 C118 66 112 88 96 104Z" fill="#B3A28B" />
        <path d="M84 116 C104 108 126 112 142 126 C120 136 100 132 84 116Z" fill="#B3A28B" />
      </svg>
    </>
  );
}
