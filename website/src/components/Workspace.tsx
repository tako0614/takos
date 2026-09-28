import { For, type JSX } from 'solid-js';
import Section from './Section';
import RichText from './RichText';
import AppVisual from './AppVisual';
import { useT } from '~/lib/i18n';

/** The stage the run happens on: the Workspace, shown through its Apps
 *  launcher surface. */
export default function Workspace(): JSX.Element {
  const t = useT();
  return (
    <Section
      id='workspace'
      index='02'
      title={t.workspace.title}
      lede={<RichText value={t.workspace.lede} />}
    >
      <ul class='ws-points'>
        <For each={t.workspace.points}>{(p) => <li>{p}</li>}</For>
      </ul>
      <AppVisual kind='install' />
    </Section>
  );
}
