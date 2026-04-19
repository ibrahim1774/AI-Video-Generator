import styles from './Navbar.module.css';

export default function Navbar({ activeTab, onTabChange }) {
  return (
    <nav className={styles.nav}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <div className={styles.mark} aria-hidden="true">F</div>
          <span className={styles.wordmark}>FaceForge</span>
        </div>

        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'create'}
            className={`${styles.tab} ${activeTab === 'create' ? styles.tabActive : ''}`}
            onClick={() => onTabChange('create')}
          >
            Create
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'history'}
            className={`${styles.tab} ${activeTab === 'history' ? styles.tabActive : ''}`}
            onClick={() => onTabChange('history')}
          >
            History
          </button>
        </div>

        <div className={styles.status}>
          <span className={styles.statusDot} aria-hidden="true" />
          <span className={styles.statusLabel}>API Connected</span>
        </div>
      </div>
    </nav>
  );
}
