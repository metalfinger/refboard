import { useEffect, useState } from 'react';
import { getBoard } from '../api';

interface BoardLoaderResult {
  boardData: any;
  loading: boolean;
  error: string;
}

/**
 * Loads board data by ID with cancellation support.
 */
export function useBoardLoader(boardId: string | undefined): BoardLoaderResult {
  const [boardData, setBoardData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        if (!boardId) {
          setError('No board specified');
          setLoading(false);
          return;
        }
        const res = await getBoard(boardId);
        if (!cancelled) {
          setBoardData(res.data);
          setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.response?.data?.error || 'Failed to load board');
          setLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [boardId]);

  return { boardData, loading, error };
}
