import { useEffect, useState } from 'react';
import { Button } from '../../ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '../../ui/dialog';
import { Input } from '../../ui/input';
import { Users as UsersIcon, BarChart, Ban, Check, DollarSign, AlertTriangle, Key } from 'lucide-react';

interface AdminUser {
  id: number;
  username: string;
  role: string;
  status: 'active' | 'suspended' | 'blocked';
  isOnline: boolean;
  chips: number;
  totalWins: number;
  totalLosses: number;
  winRate: number;
  lastActivity: string | null;
  lastLogin: string | null;
}

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Dialog states
  const [showUserStatsDialog, setShowUserStatsDialog] = useState(false);
  const [userStatsData, setUserStatsData] = useState<any>(null);
  const [showStatusConfirmDialog, setShowStatusConfirmDialog] = useState(false);
  const [statusConfirmData, setStatusConfirmData] = useState<{userId: number; status: string; action: string} | null>(null);
  const [showFundsDialog, setShowFundsDialog] = useState(false);
  const [fundsDialogData, setFundsDialogData] = useState<{userId: number; username: string} | null>(null);
  const [fundsAmount, setFundsAmount] = useState('');
  const [fundsReason, setFundsReason] = useState('');
  const [showFundsConfirmDialog, setShowFundsConfirmDialog] = useState(false);
  const [fundsConfirmData, setFundsConfirmData] = useState<{userId: number; username: string; amount: number; reason: string} | null>(null);
  const [showAlertDialog, setShowAlertDialog] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');
  const [showSuccessMessage, setShowSuccessMessage] = useState<string | null>(null);
  const [showErrorMessage, setShowErrorMessage] = useState<string | null>(null);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [passwordDialogData, setPasswordDialogData] = useState<{userId: number; username: string} | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch('/api/admin/users');
      if (!response.ok) throw new Error('Failed to fetch users');
      const data = await response.json();
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setIsLoading(false);
    }
  };

  const handleViewUserStats = async (userId: number) => {
    try {
      const response = await fetch(`/api/admin/users/${userId}/stats`);
      if (response.ok) {
        const data = await response.json();
        setUserStatsData(data);
        setShowUserStatsDialog(true);
      } else {
        setShowErrorMessage('Failed to fetch user stats');
        setTimeout(() => setShowErrorMessage(null), 3000);
      }
    } catch (err) {
      console.error('Error fetching user stats:', err);
      setShowErrorMessage('Error fetching user stats');
      setTimeout(() => setShowErrorMessage(null), 3000);
    }
  };

  const handleToggleUserStatus = (userId: number, newStatus: string) => {
    const action = newStatus === 'blocked' ? 'block' : 'unblock';
    setStatusConfirmData({ userId, status: newStatus, action });
    setShowStatusConfirmDialog(true);
  };

  const confirmStatusChange = async () => {
    if (!statusConfirmData) return;
    const { userId, status: newStatus, action } = statusConfirmData;
    setShowStatusConfirmDialog(false);

    try {
      const response = await fetch(`/api/admin/users/${userId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (response.ok) {
        const result = await response.json();
        setShowSuccessMessage(`User ${result.user.username} has been ${action}ed successfully`);
        setTimeout(() => setShowSuccessMessage(null), 3000);
        fetchUsers();
      } else {
        const error = await response.json();
        setShowErrorMessage(error.message || `Failed to ${action} user`);
        setTimeout(() => setShowErrorMessage(null), 3000);
      }
    } catch (err) {
      console.error(`Error ${action}ing user:`, err);
      setShowErrorMessage(`Error ${action}ing user`);
      setTimeout(() => setShowErrorMessage(null), 3000);
    }
  };

  const handleManageFunds = (userId: number, username: string) => {
    setFundsDialogData({ userId, username });
    setFundsAmount('');
    setFundsReason('Admin adjustment');
    setShowFundsDialog(true);
  };

  const submitFundsDialog = () => {
    const amount = parseFloat(fundsAmount);
    if (isNaN(amount) || amount === 0) {
      setAlertMessage('Please enter a valid number (not zero)');
      setShowAlertDialog(true);
      return;
    }

    if (!fundsDialogData) return;
    
    setFundsConfirmData({
      userId: fundsDialogData.userId,
      username: fundsDialogData.username,
      amount,
      reason: fundsReason || 'Admin adjustment'
    });
    setShowFundsDialog(false);
    setShowFundsConfirmDialog(true);
  };

  const confirmFundsChange = async () => {
    if (!fundsConfirmData) return;
    const { userId, username, amount, reason } = fundsConfirmData;
    setShowFundsConfirmDialog(false);

    try {
      const response = await fetch(`/api/admin/users/${userId}/funds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, reason }),
      });

      if (response.ok) {
        const result = await response.json();
        setShowSuccessMessage(`${result.message}. ${username} now has ${result.player.chips} chips.`);
        setTimeout(() => setShowSuccessMessage(null), 3000);
        fetchUsers();
      } else {
        const error = await response.json();
        setShowErrorMessage(error.message || 'Failed to update funds');
        setTimeout(() => setShowErrorMessage(null), 3000);
      }
    } catch (err) {
      console.error('Error updating funds:', err);
      setShowErrorMessage('Error updating user funds');
      setTimeout(() => setShowErrorMessage(null), 3000);
    }
  };

  const handleChangePassword = (userId: number, username: string) => {
    setPasswordDialogData({ userId, username });
    setNewPassword('');
    setConfirmPassword('');
    setShowPasswordDialog(true);
  };

  const submitPasswordChange = async () => {
    if (!passwordDialogData) return;

    if (!newPassword || newPassword.length < 6) {
      setAlertMessage('Password must be at least 6 characters long');
      setShowAlertDialog(true);
      return;
    }

    if (newPassword !== confirmPassword) {
      setAlertMessage('Passwords do not match');
      setShowAlertDialog(true);
      return;
    }

    setShowPasswordDialog(false);

    try {
      const response = await fetch(`/api/admin/users/${passwordDialogData.userId}/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      });

      if (response.ok) {
        const result = await response.json();
        setShowSuccessMessage(`Password changed successfully for ${passwordDialogData.username}`);
        setTimeout(() => setShowSuccessMessage(null), 3000);
        setNewPassword('');
        setConfirmPassword('');
      } else {
        const error = await response.json();
        setShowErrorMessage(error.message || 'Failed to change password');
        setTimeout(() => setShowErrorMessage(null), 3000);
      }
    } catch (err) {
      console.error('Error changing password:', err);
      setShowErrorMessage('Error changing password');
      setTimeout(() => setShowErrorMessage(null), 3000);
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-heading font-bold text-neo-accent mb-2 flex items-center gap-3">
          <UsersIcon className="w-8 h-8" />
          User Management
        </h1>
        <p className="text-neo-text-secondary">Manage user accounts, status, and funds</p>
      </div>

      {/* Success/Error Messages */}
      {showSuccessMessage && (
        <div className="mb-4 p-4 bg-green-500/20 border border-green-500 rounded-lg text-green-300">
          {showSuccessMessage}
        </div>
      )}
      {showErrorMessage && (
        <div className="mb-4 p-4 bg-red-500/20 border border-red-500 rounded-lg text-red-300">
          {showErrorMessage}
        </div>
      )}

      <div className="neo-glass-card p-6">
        {isLoading ? (
          <div className="text-center text-neo-text py-8">Loading users...</div>
        ) : error ? (
          <div className="text-center text-neo-danger py-8">{error}</div>
        ) : users.length === 0 ? (
          <div className="text-center text-neo-text-secondary py-8">No users registered yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-neo-border hover:bg-white/5">
                  <TableHead className="text-neo-accent font-heading">ID</TableHead>
                  <TableHead className="text-neo-accent font-heading">Username</TableHead>
                  <TableHead className="text-neo-accent font-heading">Status</TableHead>
                  <TableHead className="text-neo-accent font-heading">Online</TableHead>
                  <TableHead className="text-neo-accent font-heading">Chips</TableHead>
                  <TableHead className="text-neo-accent font-heading">Stats</TableHead>
                  <TableHead className="text-neo-accent font-heading">Last Activity</TableHead>
                  <TableHead className="text-neo-accent font-heading">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id} className="border-purple-accent/20 hover:bg-white/10">
                    <TableCell className="text-white font-medium">{user.id}</TableCell>
                    <TableCell className="text-white font-semibold">
                      {user.username}
                      {user.role === 'admin' && (
                        <span className="ml-2 text-xs bg-gradient-purple-light text-white px-2 py-1 rounded">
                          ADMIN
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        user.status === 'active' ? 'bg-green-100 text-green-800' :
                        user.status === 'blocked' ? 'bg-red-100 text-red-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {user.status?.toUpperCase() || 'ACTIVE'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <span className={`w-2 h-2 rounded-full ${user.isOnline ? 'bg-green-400' : 'bg-gray-400'}`}></span>
                        <span className="text-white text-sm">{user.isOnline ? 'Online' : 'Offline'}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-white font-medium">💰 {user.chips || 0}</TableCell>
                    <TableCell className="text-white text-sm">
                      <div>W: {user.totalWins || 0} / L: {user.totalLosses || 0}</div>
                      <div className="text-gray-400">Rate: {user.winRate || 0}%</div>
                    </TableCell>
                    <TableCell className="text-white text-sm">
                      {user.lastActivity 
                        ? new Date(user.lastActivity).toLocaleString()
                        : user.lastLogin
                        ? new Date(user.lastLogin).toLocaleString()
                        : 'Never'
                      }
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-casino-gold text-casino-gold hover:bg-casino-gold hover:text-casino-black"
                          onClick={() => handleViewUserStats(user.id)}
                        >
                          <BarChart className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-purple-500 text-purple-400 hover:bg-purple-500 hover:text-white"
                          onClick={() => handleChangePassword(user.id, user.username)}
                        >
                          <Key className="w-4 h-4" />
                        </Button>
                        {user.role !== 'admin' && (
                          <>
                            <Button
                              size="sm"
                              variant="outline" 
                              className={`${user.status === 'blocked' 
                                ? 'border-green-500 text-green-400 hover:bg-green-500' 
                                : 'border-red-500 text-red-400 hover:bg-red-500'} hover:text-white`}
                              onClick={() => handleToggleUserStatus(user.id, user.status === 'blocked' ? 'active' : 'blocked')}
                            >
                              {user.status === 'blocked' ? <Check className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-blue-500 text-blue-400 hover:bg-blue-500 hover:text-white"
                              onClick={() => handleManageFunds(user.id, user.username)}
                            >
                              <DollarSign className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* User Stats Dialog */}
      <Dialog open={showUserStatsDialog} onOpenChange={setShowUserStatsDialog}>
        <DialogContent className="neo-glass-card border-neo-accent/30">
          <DialogHeader>
            <DialogTitle className="text-neo-accent font-heading font-bold flex items-center gap-2">
              <BarChart className="w-6 h-6" />
              User Statistics
            </DialogTitle>
            <DialogDescription className="text-neo-text-secondary">
              View detailed statistics and performance metrics for the selected user.
            </DialogDescription>
          </DialogHeader>
          {userStatsData && (
            <div className="py-4 space-y-4">
              <div className="text-center pb-4 border-b border-neo-border">
                <h3 className="text-2xl font-heading font-bold text-neo-accent">{userStatsData.user.username}</h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="neo-glass-card p-4">
                  <p className="text-neo-text-secondary text-sm">Chips</p>
                  <p className="text-2xl font-mono font-bold text-neo-accent">{userStatsData.stats.chips}</p>
                </div>
                <div className="neo-glass-card p-4">
                  <p className="text-neo-text-secondary text-sm">Win Rate</p>
                  <p className="text-2xl font-mono font-bold text-neo-success">{userStatsData.stats.winRate}%</p>
                </div>
                <div className="neo-glass-card p-4">
                  <p className="text-neo-text-secondary text-sm">Total Wins</p>
                  <p className="text-2xl font-mono font-bold text-neo-text">{userStatsData.stats.totalWins}</p>
                </div>
                <div className="neo-glass-card p-4">
                  <p className="text-neo-text-secondary text-sm">Total Losses</p>
                  <p className="text-2xl font-mono font-bold text-neo-text">{userStatsData.stats.totalLosses}</p>
                </div>
                <div className="neo-glass-card p-4 col-span-2">
                  <p className="text-neo-text-secondary text-sm">Total Bets Amount</p>
                  <p className="text-2xl font-mono font-bold text-neo-accent">{userStatsData.stats.totalBetsAmount}</p>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              onClick={() => setShowUserStatsDialog(false)}
              className="border-2 border-neo-accent bg-neo-accent/20 text-neo-accent hover:bg-neo-accent hover:text-neo-bg font-heading"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Status Confirmation Dialog */}
      <Dialog open={showStatusConfirmDialog} onOpenChange={setShowStatusConfirmDialog}>
        <DialogContent className="neo-glass-card border-neo-accent/30">
          <DialogHeader>
            <DialogTitle className="text-neo-accent font-heading font-bold flex items-center gap-2">
              <AlertTriangle className="w-6 h-6" />
              Confirm User Status Change
            </DialogTitle>
            <DialogDescription className="text-neo-text-secondary">
              Confirm the user account status modification before proceeding.
            </DialogDescription>
          </DialogHeader>
          {statusConfirmData && (
            <div className="py-4">
              <p className="text-neo-text text-center">
                Are you sure you want to <span className="text-neo-accent font-bold">{statusConfirmData.action}</span> this user?
              </p>
              <p className="text-neo-text-secondary text-sm text-center mt-4">
                This action will change the user's account status and may affect their access to the platform.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowStatusConfirmDialog(false)}
              className="border-2 border-neo-accent text-neo-accent hover:bg-neo-accent hover:text-neo-bg font-heading"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmStatusChange}
              className="border-2 border-neo-accent bg-neo-accent/30 text-neo-accent hover:bg-neo-accent hover:text-neo-bg font-heading"
            >
              Yes, {statusConfirmData?.action} User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage Funds Dialog */}
      <Dialog open={showFundsDialog} onOpenChange={setShowFundsDialog}>
        <DialogContent className="neo-glass-card border-neo-accent/30">
          <DialogHeader>
            <DialogTitle className="text-neo-accent font-heading font-bold flex items-center gap-2">
              <DollarSign className="w-6 h-6" />
              Manage User Funds
            </DialogTitle>
            <DialogDescription className="text-neo-text-secondary">
              Add or remove chips for {fundsDialogData?.username}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div>
              <label className="text-neo-text text-sm font-medium mb-2 block">
                Amount (positive to add, negative to remove)
              </label>
              <Input
                type="number"
                value={fundsAmount}
                onChange={(e) => setFundsAmount(e.target.value)}
                placeholder="Enter amount (e.g., 100 or -50)"
                className="bg-neo-bg border-neo-accent/30 text-neo-text"
              />
            </div>
            <div>
              <label className="text-neo-text text-sm font-medium mb-2 block">
                Reason
              </label>
              <Input
                value={fundsReason}
                onChange={(e) => setFundsReason(e.target.value)}
                placeholder="Admin adjustment"
                className="bg-neo-bg border-neo-accent/30 text-neo-text"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowFundsDialog(false)}
              className="border-2 border-neo-accent text-neo-accent hover:bg-neo-accent hover:text-neo-bg font-heading"
            >
              Cancel
            </Button>
            <Button
              onClick={submitFundsDialog}
              className="border-2 border-neo-accent bg-neo-accent/30 text-neo-accent hover:bg-neo-accent hover:text-neo-bg font-heading"
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Funds Confirmation Dialog */}
      <Dialog open={showFundsConfirmDialog} onOpenChange={setShowFundsConfirmDialog}>
        <DialogContent className="neo-glass-card border-neo-accent/30">
          <DialogHeader>
            <DialogTitle className="text-neo-accent font-heading font-bold flex items-center gap-2">
              <AlertTriangle className="w-6 h-6" />
              Confirm Funds Change
            </DialogTitle>
          </DialogHeader>
          {fundsConfirmData && (
            <div className="py-4">
              <p className="text-neo-text text-center">
                {fundsConfirmData.amount > 0 ? 'Add' : 'Remove'} <span className="text-neo-accent font-bold">{Math.abs(fundsConfirmData.amount)} chips</span> {fundsConfirmData.amount > 0 ? 'to' : 'from'} {fundsConfirmData.username}?
              </p>
              <p className="text-neo-text-secondary text-sm text-center mt-2">
                Reason: {fundsConfirmData.reason}
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowFundsConfirmDialog(false)}
              className="border-2 border-neo-accent text-neo-accent hover:bg-neo-accent hover:text-neo-bg font-heading"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmFundsChange}
              className="border-2 border-neo-accent bg-neo-accent/30 text-neo-accent hover:bg-neo-accent hover:text-neo-bg font-heading"
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Alert Dialog */}
      <Dialog open={showAlertDialog} onOpenChange={setShowAlertDialog}>
        <DialogContent className="neo-glass-card border-neo-accent/30">
          <DialogHeader>
            <DialogTitle className="text-neo-accent font-heading font-bold">Alert</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-neo-text text-center">{alertMessage}</p>
          </div>
          <DialogFooter>
            <Button
              onClick={() => setShowAlertDialog(false)}
              className="border-2 border-neo-accent bg-neo-accent/20 text-neo-accent hover:bg-neo-accent hover:text-neo-bg font-heading"
            >
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Password Dialog */}
      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent className="neo-glass-card border-neo-accent/30">
          <DialogHeader>
            <DialogTitle className="text-neo-accent font-heading font-bold flex items-center gap-2">
              <Key className="w-6 h-6" />
              Change User Password
            </DialogTitle>
            <DialogDescription className="text-neo-text-secondary">
              Set a new password for {passwordDialogData?.username}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div>
              <label className="text-neo-text text-sm font-medium mb-2 block">
                New Password
              </label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password (min 6 characters)"
                className="bg-neo-bg border-neo-accent/30 text-neo-text"
              />
            </div>
            <div>
              <label className="text-neo-text text-sm font-medium mb-2 block">
                Confirm Password
              </label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                className="bg-neo-bg border-neo-accent/30 text-neo-text"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowPasswordDialog(false)}
              className="border-2 border-neo-accent text-neo-accent hover:bg-neo-accent hover:text-neo-bg font-heading"
            >
              Cancel
            </Button>
            <Button
              onClick={submitPasswordChange}
              className="border-2 border-neo-accent bg-neo-accent/30 text-neo-accent hover:bg-neo-accent hover:text-neo-bg font-heading"
            >
              Change Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
