import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://kqjrvqllrajidpakrkni.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtxanJ2cWxscmFqaWRwYWtya25pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NjAwNjAsImV4cCI6MjA5MTAzNjA2MH0.wkCzhWCqA1ddnMvWtM84mKgY995hamjEItNwYDsAH90';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables. Please check your .env file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
