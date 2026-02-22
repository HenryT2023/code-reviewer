import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

export interface EntityInfo {
  name: string;
  tableName: string;
  columns: ColumnInfo[];
  relations: RelationInfo[];
  file: string;
  orm: 'typeorm' | 'sqlalchemy' | 'prisma' | 'drizzle' | 'unknown';
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  primary: boolean;
}

export interface RelationInfo {
  type: 'OneToMany' | 'ManyToOne' | 'OneToOne' | 'ManyToMany' | 'ForeignKey';
  target: string;
  field: string;
}

export interface DatabaseAnalysis {
  entities: EntityInfo[];
  totalEntities: number;
  totalColumns: number;
  relations: number;
  orms: string[];
  hasMigrations: boolean;
  migrationCount: number;
}

export async function analyzeDatabase(projectPath: string): Promise<DatabaseAnalysis> {
  const entities: EntityInfo[] = [];
  let totalColumns = 0;
  let totalRelations = 0;
  const orms = new Set<string>();

  // TypeORM entities
  const typeormEntities = await analyzeTypeOrmEntities(projectPath);
  if (typeormEntities.length > 0) orms.add('TypeORM');
  entities.push(...typeormEntities);

  // SQLAlchemy models
  const sqlalchemyEntities = await analyzeSqlAlchemyModels(projectPath);
  if (sqlalchemyEntities.length > 0) orms.add('SQLAlchemy');
  entities.push(...sqlalchemyEntities);

  // Prisma models
  const prismaEntities = await analyzePrismaModels(projectPath);
  if (prismaEntities.length > 0) orms.add('Prisma');
  entities.push(...prismaEntities);

  // Drizzle ORM tables
  const drizzleEntities = await analyzeDrizzleEntities(projectPath);
  if (drizzleEntities.length > 0) orms.add('Drizzle');
  entities.push(...drizzleEntities);

  for (const entity of entities) {
    totalColumns += entity.columns.length;
    totalRelations += entity.relations.length;
  }

  // Check migrations
  const { hasMigrations, migrationCount } = await detectMigrations(projectPath);

  return {
    entities,
    totalEntities: entities.length,
    totalColumns,
    relations: totalRelations,
    orms: Array.from(orms),
    hasMigrations,
    migrationCount,
  };
}

// --- TypeORM ---
async function analyzeTypeOrmEntities(projectPath: string): Promise<EntityInfo[]> {
  const entities: EntityInfo[] = [];
  const entityFiles = await glob('**/src/**/*.entity.ts', {
    cwd: projectPath, ignore: ['**/node_modules/**'],
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
      columns.push({
        name: columnMatch[2], type: columnMatch[3],
        nullable: columnMatch[1].includes('nullable: true'),
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
        const targetMatch = content.substring(relMatch.index - 100, relMatch.index + 50).match(/=>\s*(\w+)/);
        relations.push({ type, target: targetMatch ? targetMatch[1] : 'unknown', field: relMatch[1] });
      }
    }
    entities.push({ name: entityName, tableName, columns, relations, file, orm: 'typeorm' });
  }
  return entities;
}

// --- SQLAlchemy / SQLModel ---
async function analyzeSqlAlchemyModels(projectPath: string): Promise<EntityInfo[]> {
  const entities: EntityInfo[] = [];
  const pyFiles = await glob('**/models*.py', {
    cwd: projectPath,
    ignore: ['**/node_modules/**', '**/.venv/**', '**/venv/**', '**/__pycache__/**', '**/migrations/**', '**/alembic/**'],
  });

  // Also check app/models/ directory pattern
  const modelDirFiles = await glob('**/models/**/*.py', {
    cwd: projectPath,
    ignore: ['**/node_modules/**', '**/.venv/**', '**/venv/**', '**/__pycache__/**', '**/migrations/**', '**/alembic/**'],
  });

  // Check db/ directory pattern (common in FastAPI projects)
  const dbDirFiles = await glob('**/db/**/*.py', {
    cwd: projectPath,
    ignore: ['**/node_modules/**', '**/.venv/**', '**/venv/**', '**/__pycache__/**', '**/migrations/**', '**/alembic/**'],
  });

  const allFiles = [...new Set([...pyFiles, ...modelDirFiles, ...dbDirFiles])];

  for (const file of allFiles) {
    const filePath = path.join(projectPath, file);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      // Check for SQLAlchemy or SQLModel indicators
      if (!content.includes('Column') && !content.includes('mapped_column') && !content.includes('Mapped') 
          && !content.includes('SQLModel') && !content.includes('Field(')) continue;

      // Match class Xxx(Base), class Xxx(db.Model), or class Xxx(SQLModel, table=True) patterns
      const classPattern = /class\s+(\w+)\s*\([^)]*(?:Base|Model|DeclarativeBase|db\.Model|SQLModel)[^)]*\)\s*:/g;
      let classMatch;
      while ((classMatch = classPattern.exec(content)) !== null) {
        const className = classMatch[1];
        const columns: ColumnInfo[] = [];
        const relations: RelationInfo[] = [];

        // Get class body (until next class or end)
        const classStart = classMatch.index;
        const nextClassMatch = content.substring(classStart + 10).match(/\nclass\s+\w+/);
        const classBody = nextClassMatch
          ? content.substring(classStart, classStart + 10 + nextClassMatch.index)
          : content.substring(classStart);

        // Table name
        const tableMatch = classBody.match(/__tablename__\s*=\s*['"](\w+)['"]/);
        const tableName = tableMatch ? tableMatch[1] : className.toLowerCase();

        // SQLAlchemy 2.0 style: field: Mapped[type] = mapped_column(...)
        const mappedPattern = /(\w+)\s*:\s*Mapped\[([^\]]+)\]\s*=\s*mapped_column\(([^)]*)\)/g;
        let colMatch;
        while ((colMatch = mappedPattern.exec(classBody)) !== null) {
          columns.push({
            name: colMatch[1], type: colMatch[2].replace(/Optional\[|\]/g, ''),
            nullable: colMatch[2].includes('Optional') || colMatch[3].includes('nullable=True'),
            primary: colMatch[3].includes('primary_key=True') || colMatch[3].includes('primary_key'),
          });
        }

        // Classic style: field = Column(Type, ...)
        const classicPattern = /(\w+)\s*=\s*Column\(\s*(\w+)(?:\([^)]*\))?\s*(?:,\s*([^)]*))?\)/g;
        while ((colMatch = classicPattern.exec(classBody)) !== null) {
          const opts = colMatch[3] || '';
          columns.push({
            name: colMatch[1], type: colMatch[2],
            nullable: opts.includes('nullable=True') || !opts.includes('nullable=False'),
            primary: opts.includes('primary_key=True') || opts.includes('primary_key'),
          });
        }

        // SQLModel style: field: type = Field(...) or field: Optional[type] = Field(...)
        const sqlmodelPattern = /(\w+)\s*:\s*(Optional\[)?(\w+)\]?\s*=\s*Field\(([^)]*)\)/g;
        while ((colMatch = sqlmodelPattern.exec(classBody)) !== null) {
          const opts = colMatch[4] || '';
          const isOptional = !!colMatch[2];
          columns.push({
            name: colMatch[1], 
            type: colMatch[3],
            nullable: isOptional || opts.includes('default=None') || opts.includes('nullable=True'),
            primary: opts.includes('primary_key=True') || opts.includes('primary_key'),
          });
        }

        // SQLModel Relationship style: field: List["Target"] = Relationship(back_populates="xxx")
        const sqlmodelRelPattern = /(\w+)\s*:\s*(?:List\[)?["']?(\w+)["']?\]?\s*=\s*Relationship\(/g;
        while ((colMatch = sqlmodelRelPattern.exec(classBody)) !== null) {
          relations.push({ type: 'OneToMany', target: colMatch[2], field: colMatch[1] });
        }

        // Relationships
        const relPattern = /(\w+)\s*(?::\s*Mapped[^=]*)?=\s*relationship\(\s*['"]?(\w+)['"]?/g;
        let relMatch;
        while ((relMatch = relPattern.exec(classBody)) !== null) {
          relations.push({ type: 'OneToMany', target: relMatch[2], field: relMatch[1] });
        }

        // ForeignKey
        const fkPattern = /(\w+)\s*(?::\s*Mapped[^=]*)?=\s*(?:mapped_column|Column)\([^)]*ForeignKey\(\s*['"]([^'"]+)['"]\)/g;
        while ((relMatch = fkPattern.exec(classBody)) !== null) {
          relations.push({ type: 'ForeignKey', target: relMatch[2].split('.')[0], field: relMatch[1] });
        }

        if (columns.length > 0 || relations.length > 0) {
          entities.push({ name: className, tableName, columns, relations, file, orm: 'sqlalchemy' });
        }
      }
    } catch { /* skip */ }
  }
  return entities;
}

// --- Prisma ---
async function analyzePrismaModels(projectPath: string): Promise<EntityInfo[]> {
  const entities: EntityInfo[] = [];
  const schemaFiles = await glob('**/schema.prisma', {
    cwd: projectPath, ignore: ['**/node_modules/**'],
  });

  for (const file of schemaFiles) {
    const filePath = path.join(projectPath, file);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const modelPattern = /model\s+(\w+)\s*\{([^}]+)\}/g;
      let modelMatch;
      while ((modelMatch = modelPattern.exec(content)) !== null) {
        const modelName = modelMatch[1];
        const body = modelMatch[2];
        const columns: ColumnInfo[] = [];
        const relations: RelationInfo[] = [];

        const lines = body.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('@@') && !l.startsWith('//'));
        for (const line of lines) {
          const fieldMatch = line.match(/^(\w+)\s+(String|Int|Float|Boolean|DateTime|BigInt|Decimal|Json|Bytes)(\?)?/);
          if (fieldMatch) {
            columns.push({
              name: fieldMatch[1], type: fieldMatch[2],
              nullable: !!fieldMatch[3], primary: line.includes('@id'),
            });
          }
          const relMatch = line.match(/^(\w+)\s+(\w+)(\[\])?\s/);
          if (relMatch && !fieldMatch) {
            relations.push({ type: relMatch[3] ? 'OneToMany' : 'ManyToOne', target: relMatch[2], field: relMatch[1] });
          }
        }
        entities.push({ name: modelName, tableName: modelName.toLowerCase(), columns, relations, file, orm: 'prisma' });
      }
    } catch { /* skip */ }
  }
  return entities;
}

// --- Migrations ---
async function detectMigrations(projectPath: string): Promise<{ hasMigrations: boolean; migrationCount: number }> {
  let count = 0;
  // Alembic
  const alembicFiles = await glob('**/alembic/versions/*.py', { cwd: projectPath, ignore: ['**/node_modules/**', '**/.venv/**'] });
  count += alembicFiles.length;
  // TypeORM
  const typeormMigrations = await glob('**/migrations/*.ts', { cwd: projectPath, ignore: ['**/node_modules/**'] });
  count += typeormMigrations.length;
  // Prisma
  const prismaMigrations = await glob('**/prisma/migrations/*/migration.sql', { cwd: projectPath, ignore: ['**/node_modules/**'] });
  count += prismaMigrations.length;
  // Custom migrations
  const customMigrations = await glob('**/migrations/*.py', { cwd: projectPath, ignore: ['**/node_modules/**', '**/.venv/**', '**/alembic/**'] });
  count += customMigrations.length;
  // Drizzle migrations
  const drizzleMigrations = await glob('**/drizzle/*.sql', { cwd: projectPath, ignore: ['**/node_modules/**'] });
  count += drizzleMigrations.length;

  return { hasMigrations: count > 0, migrationCount: count };
}

// --- Drizzle ORM ---
async function analyzeDrizzleEntities(projectPath: string): Promise<EntityInfo[]> {
  const entities: EntityInfo[] = [];
  const schemaFiles = await glob('**/src/**/*.ts', {
    cwd: projectPath,
    ignore: ['**/node_modules/**', '**/*.test.ts', '**/*.spec.ts'],
  });

  for (const file of schemaFiles) {
    const filePath = path.join(projectPath, file);
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch { continue; }

    // Must import from drizzle-orm
    if (!content.includes('drizzle-orm')) continue;

    // Match sqliteTable / pgTable / mysqlTable calls
    const tablePattern = /export\s+const\s+(\w+)\s*=\s*(?:sqliteTable|pgTable|mysqlTable)\(\s*['"]([\w-]+)['"]\s*,\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/g;
    let tableMatch;
    while ((tableMatch = tablePattern.exec(content)) !== null) {
      const varName = tableMatch[1];
      const tableName = tableMatch[2];
      const body = tableMatch[3];
      const columns: ColumnInfo[] = [];
      const relations: RelationInfo[] = [];

      // Parse columns: fieldName: text('col_name').notNull().primaryKey()
      const colPattern = /(\w+):\s*(?:text|integer|real|blob)\(['"]([\w-]*)['"](?:,\s*\{[^}]*\})?\)([^,\n]*)/g;
      let colMatch;
      while ((colMatch = colPattern.exec(body)) !== null) {
        const chain = colMatch[3] || '';
        columns.push({
          name: colMatch[1],
          type: colMatch[0].match(/^\w+:\s*(\w+)/)?.[1] || 'text',
          nullable: !chain.includes('.notNull()'),
          primary: chain.includes('.primaryKey()'),
        });
      }

      // Detect .references(() => xxx.id) as ForeignKey relations
      const refPattern = /(\w+):[^,]*\.references\(\(\)\s*=>\s*(\w+)\.(\w+)\)/g;
      let refMatch;
      while ((refMatch = refPattern.exec(body)) !== null) {
        relations.push({
          type: 'ForeignKey',
          target: refMatch[2],
          field: refMatch[1],
        });
      }

      if (columns.length > 0) {
        entities.push({
          name: varName,
          tableName,
          columns,
          relations,
          file,
          orm: 'drizzle',
        });
      }
    }
  }
  return entities;
}
