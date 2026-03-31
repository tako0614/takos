import { Icons } from '../../lib/Icons.tsx';
import { Button } from '../ui/index.ts';

interface ProfileLoadMoreButtonProps {
  onLoadMore: () => void;
}

export function ProfileLoadMoreButton(props: ProfileLoadMoreButtonProps) {
  return (
    <div style={{ display: 'flex', 'justify-content': 'center', 'margin-top': '1.5rem' }}>
      <Button
        variant="secondary"
        onClick={props.onLoadMore}
        leftIcon={<Icons.ChevronDown style={{ width: '1rem', height: '1rem' }} />}
      >
        Load More
      </Button>
    </div>
  );
}
