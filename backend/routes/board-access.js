const { getBoard, getCollection, getCollectionMember } = require('../db');

function hasCollectionRole(member, minRole) {
  if (!member) return false;
  const hierarchy = { owner: 3, editor: 2, viewer: 1 };
  return (hierarchy[member.role] || 0) >= (hierarchy[minRole] || 0);
}

function resolveBoard(req, res, minRole = 'viewer') {
  const board = getBoard(req.params.boardId);
  if (!board) { res.status(404).json({ error: 'Board not found' }); return null; }

  const collection = getCollection(board.collection_id);
  if (!collection) { res.status(404).json({ error: 'Collection not found' }); return null; }

  const member = getCollectionMember(board.collection_id, req.user.id);
  if (minRole === 'viewer' && collection.is_public) {
    return { board, collection, member: member || { role: 'viewer' } };
  }
  if (!hasCollectionRole(member, minRole)) {
    res.status(403).json({ error: `${minRole} access required` });
    return null;
  }
  return { board, collection, member };
}

module.exports = { hasCollectionRole, resolveBoard };
