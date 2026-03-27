import { useState, type FormEvent } from 'react';
import { useI18n } from '../../store/i18n';
import { Icons } from '../../lib/Icons';
import { Button, Card, Badge, Input, Textarea, Modal, ModalFooter } from '../../components/ui';
import type { Memory } from '../../types';

function getTypeIcon(type: Memory['type']) {
  switch (type) {
    case 'episode': return '📅';
    case 'semantic': return '💡';
    case 'procedural': return '📋';
  }
}

function getTypeLabel(type: Memory['type'], t: (key: string) => string) {
  switch (type) {
    case 'episode': return t('memoryEpisode');
    case 'semantic': return t('memorySemantic');
    case 'procedural': return t('memoryProcedural');
  }
}

import { Select } from '../../components/ui';

export function MemoryList({
  memories,
  onDelete,
  onCreateMemory,
  savingMemory,
}: {
  memories: Memory[];
  onDelete: (id: string) => void;
  onCreateMemory: (data: { content: string; type: Memory['type']; category?: string }) => Promise<void>;
  savingMemory: boolean;
}) {
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'episode' | 'semantic' | 'procedural'>('all');
  const [showCreateMemory, setShowCreateMemory] = useState(false);

  const [memoryContent, setMemoryContent] = useState('');
  const [memoryType, setMemoryType] = useState<Memory['type']>('semantic');
  const [memoryCategory, setMemoryCategory] = useState('');

  const filteredMemories = memories.filter(m => {
    const matchesFilter = activeFilter === 'all' || m.type === activeFilter;
    const matchesSearch = !searchQuery ||
      m.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (m.category && m.category.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesFilter && matchesSearch;
  });

  const handleCreateMemory = async (e: FormEvent) => {
    e.preventDefault();
    if (!memoryContent.trim()) return;
    await onCreateMemory({
      content: memoryContent.trim(),
      type: memoryType,
      category: memoryCategory.trim() || undefined,
    });
    setMemoryContent('');
    setMemoryCategory('');
    setShowCreateMemory(false);
  };

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <Input
          placeholder={t('memorySearch')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leftIcon={<Icons.Search style={{ width: '1rem', height: '1rem' }} />}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {(['all', 'episode', 'semantic', 'procedural'] as const).map(filter => (
            <Button
              key={filter}
              variant={activeFilter === filter ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setActiveFilter(filter)}
            >
              {filter === 'all' ? t('taskFilterAll') : `${getTypeIcon(filter)} ${getTypeLabel(filter, t)}`}
            </Button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {filteredMemories.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 0', color: 'var(--color-text-tertiary)', gap: '0.75rem' }}>
            <Icons.HardDrive />
            <p>{t('noMemories')}</p>
          </div>
        ) : (
          filteredMemories.map(memory => (
            <Card key={memory.id} padding="md">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <Badge variant="default">
                  {getTypeIcon(memory.type)} {getTypeLabel(memory.type, t)}
                </Badge>
                {memory.category && (
                  <Badge variant="default">{memory.category}</Badge>
                )}
                <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.875rem', marginLeft: 'auto' }} title={t('memoryImportance')}>
                  {'★'.repeat(Math.round(memory.importance * 5))}
                  {'☆'.repeat(5 - Math.round(memory.importance * 5))}
                </span>
              </div>
              <div style={{ color: 'var(--color-text-primary)', fontSize: '0.875rem', lineHeight: '1.6' }}>
                {memory.content}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--color-border-primary)' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                  {t('memoryAccessCount')}: {memory.access_count}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                  {new Date(memory.created_at).toLocaleDateString()}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(memory.id)}
                  title={t('deleteMemory')}
                  style={{ color: 'var(--color-text-tertiary)' }}
                >
                  <Icons.Trash />
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>

      <Button
        variant="secondary"
        leftIcon={<Icons.Plus />}
        onClick={() => setShowCreateMemory(true)}
        style={{ width: '100%', marginTop: '0.5rem', border: '2px dashed var(--color-border-primary)' }}
      >
        {t('createMemory')}
      </Button>

      <Modal
        isOpen={showCreateMemory}
        onClose={() => setShowCreateMemory(false)}
        title={t('createMemory')}
      >
        <form onSubmit={handleCreateMemory}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>{t('memoryContent')}</label>
              <Textarea
                placeholder={t('memoryContentPlaceholder')}
                value={memoryContent}
                onChange={e => setMemoryContent(e.target.value)}
                rows={4}
                required
                autoFocus
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>{t('memoryType')}</label>
              <Select
                value={memoryType}
                onChange={(value) => setMemoryType(value as Memory['type'])}
                options={[
                  { value: 'semantic', label: `${getTypeIcon('semantic')} ${t('memorySemantic')}` },
                  { value: 'episode', label: `${getTypeIcon('episode')} ${t('memoryEpisode')}` },
                  { value: 'procedural', label: `${getTypeIcon('procedural')} ${t('memoryProcedural')}` },
                ]}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>{t('memoryCategory')}</label>
              <Input
                placeholder={t('memoryCategoryPlaceholder')}
                value={memoryCategory}
                onChange={e => setMemoryCategory(e.target.value)}
              />
            </div>
          </div>
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => setShowCreateMemory(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" variant="primary" isLoading={savingMemory} disabled={!memoryContent.trim()}>
              {t('create')}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </>
  );
}
