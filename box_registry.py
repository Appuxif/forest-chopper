"""O(log n) expiry scheduling and 24m spatial lookup for server loot.
Mutation-compatible with the existing World.boxes dictionary and save format.
"""
from collections import defaultdict
import heapq
import math

CELL_SIZE=24
AOI_RADIUS=120


def cell_of(x,z):
    return math.floor(x/CELL_SIZE),math.floor(z/CELL_SIZE)


class TrackedBox(dict):
    # Most mutations are item-count/mask updates. Only position or expiry
    # changes require rebuilding the spatial / expiry entry.
    def __init__(self,value,on_location_change):
        super().__init__(value)
        self.on_location_change=on_location_change

    def __setitem__(self,key,value):
        old=self.get(key)
        super().__setitem__(key,value)
        if key in ('expires_at','x','z') and value!=old:
            self.on_location_change()


class BoxRegistry(dict):
    def __init__(self,values=None):
        super().__init__()
        self.cells=defaultdict(set)
        self.heap=[]
        self.versions={}
        self.sequence=0
        if values:self.update(values)

    def __setitem__(self,ident,box):
        if ident in self:self._unlink(ident,super().__getitem__(ident))
        super().__setitem__(ident,TrackedBox(box,lambda:self._changed(ident)))
        self.cells[cell_of(box['x'],box['z'])].add(ident)
        self.sequence+=1
        self.versions[ident]=self.sequence
        heapq.heappush(self.heap,(box['expires_at'],self.sequence,ident))
        if len(self.heap)>max(128,4*len(self)):self._compact()

    def _changed(self,ident):
        # Supports explicitly changing a deadline while keeping O(log N)
        # expiry access (including legacy server test fixtures).
        if ident in self:self[ident]=dict(self[ident])

    def _compact(self):
        self.heap=[(box['expires_at'],self.versions[ident],ident)
                   for ident,box in self.items()]
        heapq.heapify(self.heap)

    def _unlink(self,ident,box):
        cell=cell_of(box['x'],box['z'])
        group=self.cells.get(cell)
        if group is not None:
            group.discard(ident)
            if not group:del self.cells[cell]
        self.versions.pop(ident,None)

    def __delitem__(self,ident):
        box=super().__getitem__(ident)
        self._unlink(ident,box)
        super().__delitem__(ident)

    def pop(self,ident,*default):
        if ident not in self:
            if default:return default[0]
            raise KeyError(ident)
        box=self[ident]
        del self[ident]
        return box

    def clear(self):
        super().clear()
        self.cells.clear()
        self.heap.clear()
        self.versions.clear()

    def update(self,values=(),**kwargs):
        for ident,box in dict(values,**kwargs).items():self[ident]=box

    def nearby(self,x,z,radius=AOI_RADIUS):
        cx0,cz0=cell_of(x-radius,z-radius)
        cx1,cz1=cell_of(x+radius,z+radius)
        for cx in range(cx0,cx1+1):
            for cz in range(cz0,cz1+1):
                for ident in self.cells.get((cx,cz),()):
                    box=self[ident]
                    if math.hypot(box['x']-x,box['z']-z)<=radius:
                        yield ident,box

    def expired(self,now):
        expired=[]
        while self.heap and self.heap[0][0]<=now:
            exp,version,ident=heapq.heappop(self.heap)
            if self.versions.get(ident)!=version:continue
            # Expiration timestamps remain immutable; partial log pickups
            # only update mask/count, never their TTL.
            del self[ident]
            expired.append(ident)
        return expired
