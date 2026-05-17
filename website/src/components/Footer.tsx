import Wordmark from './brand/Wordmark';

export default function Footer() {
  return (
    <footer class='site'>
      <div class='container'>
        <div style='display: flex; align-items: center; gap: 12px;'>
          <Wordmark variant='inkdrop' size={20} />
          <span class='copy'>© Takos contributors — AGPL · Powered by Takosumi.</span>
        </div>
        <nav aria-label='Footer'>
          <a href='https://docs.takos.jp/' rel='external'>Docs</a>
          <a href='https://github.com/tako0614/takos' rel='noopener'>GitHub</a>
          <a href='https://takosumi.com/' rel='external'>Takosumi</a>
          <a href='https://cloud.takosumi.com/' rel='noopener'>Cloud</a>
        </nav>
      </div>
    </footer>
  );
}
