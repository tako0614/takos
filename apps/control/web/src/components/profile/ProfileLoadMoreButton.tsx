import { Icons } from '../../lib/Icons';
import { Button } from '../ui';

interface ProfileLoadMoreButtonProps {
  onLoadMore: () => void;
}

export function ProfileLoadMoreButton({ onLoadMore }: ProfileLoadMoreButtonProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.5rem' }}>
      <Button
        variant="secondary"
        onClick={onLoadMore}
        leftIcon={<Icons.ChevronDown style={{ width: '1rem', height: '1rem' }} />}
      >
        Load More
      </Button>
    </div>
  );
}
