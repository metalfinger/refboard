import { useState, useEffect, useCallback, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import type { Viewport } from 'pixi-viewport';

interface FollowState {
  followingUserId: string | null;
  followingDisplayName: string | null;
}

interface UseFollowModeProps {
  socket: Socket | null;
  boardId: string | undefined;
  getViewport: () => Viewport | null;
}

interface UseFollowModeReturn {
  followingUserId: string | null;
  followingDisplayName: string | null;
  startFollowing: (userId: string, displayName: string) => void;
  stopFollowing: () => void;
}

/**
 * Follow mode — click a user's avatar to track their viewport in real-time.
 * Broadcasts own viewport position so others can follow us.
 * Pan/zoom manually to break free.
 */
export function useFollowMode({ socket, boardId, getViewport }: UseFollowModeProps): UseFollowModeReturn {
  const [state, setState] = useState<FollowState>({
    followingUserId: null,
    followingDisplayName: null,
  });
  const followRef = useRef<string | null>(null);
  const ignoreNextMove = useRef(false);

  // Broadcast own viewport position (always, so others can follow us)
  useEffect(() => {
    if (!socket || !boardId) return;

    const timer = setInterval(() => {
      const vp = getViewport();
      if (!vp) return;
      socket.volatile.emit('viewport:sync', {
        boardId,
        x: vp.center.x,
        y: vp.center.y,
        scale: vp.scale.x,
      });
    }, 150);

    return () => clearInterval(timer);
  }, [socket, boardId, getViewport]);

  // Listen for viewport:sync from followed user and animate to match
  useEffect(() => {
    if (!socket) return;

    const onViewportSync = (data: { boardId: string; userId: string; x: number; y: number; scale: number }) => {
      if (data.boardId !== boardId) return;
      const targetId = followRef.current;
      if (!targetId || data.userId !== targetId) return;

      const vp = getViewport();
      if (!vp) return;

      ignoreNextMove.current = true;
      vp.animate({
        time: 200,
        position: { x: data.x, y: data.y },
        scale: data.scale,
        ease: 'easeOutQuad',
        callbackOnComplete: () => {
          // Brief delay before re-enabling break-free detection
          setTimeout(() => { ignoreNextMove.current = false; }, 50);
        },
      });
    };

    socket.on('viewport:sync', onViewportSync);
    return () => { socket.off('viewport:sync', onViewportSync); };
  }, [socket, boardId, getViewport]);

  // Detect manual pan/zoom to break free from follow mode
  useEffect(() => {
    const vp = getViewport();
    if (!vp) return;

    const onMoved = () => {
      if (ignoreNextMove.current) return;
      if (followRef.current) {
        followRef.current = null;
        setState({ followingUserId: null, followingDisplayName: null });
        socket?.emit('follow:stop', { boardId });
      }
    };

    vp.on('moved-end', onMoved);
    return () => { vp.off('moved-end', onMoved); };
  }, [getViewport, socket, boardId]);

  const startFollowing = useCallback((userId: string, displayName: string) => {
    // Toggle: if already following this user, stop
    if (followRef.current === userId) {
      followRef.current = null;
      setState({ followingUserId: null, followingDisplayName: null });
      socket?.emit('follow:stop', { boardId });
      return;
    }

    followRef.current = userId;
    setState({ followingUserId: userId, followingDisplayName: displayName });
    socket?.emit('follow:start', { boardId, targetUserId: userId });
  }, [socket, boardId]);

  const stopFollowing = useCallback(() => {
    followRef.current = null;
    setState({ followingUserId: null, followingDisplayName: null });
    socket?.emit('follow:stop', { boardId });
  }, [socket, boardId]);

  return {
    followingUserId: state.followingUserId,
    followingDisplayName: state.followingDisplayName,
    startFollowing,
    stopFollowing,
  };
}
