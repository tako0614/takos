import chalk from 'chalk';

export type TranslationIssue = {
  category: 'resource' | 'workload' | 'route';
  name: string;
  message: string;
};

export type TranslationReport = {
  provider: string;
  supported: boolean;
  requirements?: string[];
  unsupported: TranslationIssue[];
};

export function printTranslationReport(report: TranslationReport): void {
  console.log(chalk.bold('Translation:'));
  console.log(`  Provider: ${report.provider}`);
  console.log(`  Status:   ${report.supported ? chalk.green('supported') : chalk.yellow('partial / blocked')}`);

  if (report.requirements && report.requirements.length > 0) {
    console.log(`  Needs:    ${report.requirements.join(', ')}`);
  }

  if (report.unsupported.length > 0) {
    console.log('');
    console.log(chalk.bold('Blocked:'));
    for (const issue of report.unsupported) {
      console.log(`  ${chalk.red('!')} ${issue.category}.${issue.name} ${issue.message}`);
    }
  }

  console.log('');
}
