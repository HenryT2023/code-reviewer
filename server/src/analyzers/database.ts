import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

export interface EntityInfo {
  name: string;
  tableName: string;
  columns: ColumnInfo[];
  relations: RelationInfo[];
  file: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  primary: boolean;
}

export interface RelationInfo {
  type: 'OneToMany' | 'ManyToOne' | 'OneToOne' | 'ManyToMany';
  target: string;
  field: string;
}

export interface DatabaseAnalysis {
  entities: EntityInfo[];
  totalEntities: number;
  totalColumns: number;
  relations: number;
}

export async function analyzeDatabase(projectPath: string): Promise<DatabaseAnalysis> {
  const entities: EntityInfo[] = [];
  let totalColumns = 0;
  let totalRelations = 0;

  const entityFiles = await glob('**/src/**/*.entity.ts', {
    cwd: projectPath,
    ignore: ['**/node_modules/**'],
  });

  for (const file of entityFiles) {
    const filePath = path.join(projectPath, file);
    const content = fs.readFileSync(filePath, 'utf-8');

    const entityMatch = content.match(/@Entity\(['"]?([^'")\s]*)?['"]?\)/);
    if (!entityMatch) continue;

    const classMatch = content.match(/export\s+class\s+(\w+)/);
    const entityName = classMatch ? classMatch[1] : path.basename(file, '.entity.ts');
    const tableName = entityMatch[1] || entityName.toLowerCase();

    const columns: ColumnInfo[] = [];
    const relations: RelationInfo[] = [];

    const columnPattern = /@(?:Column|PrimaryGeneratedColumn|PrimaryColumn)\(([^)]*)\)\s*\n\s*(\w+)(?:\?)?:\s*(\w+)/g;
    let columnMatch;
    while ((columnMatch = columnPattern.exec(content)) !== null) {
      const options = columnMatch[1];
      const name = columnMatch[2];
      const type = columnMatch[3];
      
      columns.push({
        name,
        type,
        nullable: options.includes('nullable: true'),
        primary: columnMatch[0].includes('Primary'),
      });
    }

    const relationPatterns = [
      { pattern: /@OneToMany\([^)]+\)\s*\n\s*(\w+)/g, type: 'OneToMany' as const },
      { pattern: /@ManyToOne\([^)]+\)\s*\n\s*(\w+)/g, type: 'ManyToOne' as const },
      { pattern: /@OneToOne\([^)]+\)\s*\n\s*(\w+)/g, type: 'OneToOne' as const },
      { pattern: /@ManyToMany\([^)]+\)\s*\n\s*(\w+)/g, type: 'ManyToMany' as const },
    ];

    for (const { pattern, type } of relationPatterns) {
      let relMatch;
      while ((relMatch = pattern.exec(content)) !== null) {
        const targetMatch = content.substring(relMatch.index - 100, relMatch.index + 50)
          .match(/=>\s*(\w+)/);
        relations.push({
          type,
          target: targetMatch ? targetMatch[1] : 'unknown',
          field: relMatch[1],
        });
      }
    }

    totalColumns += columns.length;
    totalRelations += relations.length;

    entities.push({
      name: entityName,
      tableName,
      columns,
      relations,
      file,
    });
  }

  return {
    entities,
    totalEntities: entities.length,
    totalColumns,
    relations: totalRelations,
  };
}
