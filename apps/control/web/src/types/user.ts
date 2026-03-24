export interface User {
  email: string;
  name: string;
  username: string;
  picture: string | null;
  setup_completed: boolean;
}

export interface UserSettings {
  setup_completed: boolean;
  auto_update_enabled: boolean;
  private_account: boolean;
  activity_visibility: 'public' | 'followers' | 'private';
  ai_model: string;
  available_models: string[];
}
