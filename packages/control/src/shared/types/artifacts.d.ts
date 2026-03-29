export type ArtifactType = 'code' | 'config' | 'doc' | 'patch' | 'report' | 'other';
export interface Artifact {
    id: string;
    run_id: string;
    space_id: string;
    type: ArtifactType;
    title: string | null;
    content: string | null;
    file_id: string | null;
    metadata: string;
    created_at: string;
}
//# sourceMappingURL=artifacts.d.ts.map