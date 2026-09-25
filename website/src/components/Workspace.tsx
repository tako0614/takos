import { For, type JSX } from 'solid-js';
import Section from './Section';
import RichText from './RichText';
import AppVisual from './AppVisual';
import { useT } from '~/lib/i18n';
import { reveal } from '~/lib/interactions';

/** The stage the run happens on: the Workspace, shown through its Apps
 *  launcher surface. */
export default function Workspace(): JSX.Element {
  const t = useT();
  void reveal;
  return (
    <Section
      id='workspace'
      title={t.workspace.title}
      lede={<RichText value={t.workspace.lede} />}
    >
      <div class='ws reveal' use:reveal>
        <ul class='ws-points'>
          <For each={t.workspace.points}>{(p) => <li>{p}</li>}</For>
        </ul>
        <div class='ws-visual'>
          <AppVisual kind='space' />
        </div>
      </div>
    </Section>
  );
}
