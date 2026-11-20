import copy
import unittest
from types import SimpleNamespace
import stat
from unittest.mock import patch
import panel_population_agent as agent

EPOCH='a'*64
VERSION='b'*64

def snapshot():
    return {'schema':1,'target_id':'bzss-node','available':True,'observed_at':agent.time.time(),
            'epoch':EPOCH,'reason':'ready','config':{'version':VERSION,'target':0,'enabled':False,'capacity':100,'reserved_slots':1},
            'runtime':{'armed':True,'failed':False,'gt_fresh':True,'census_fresh':True,'admission_fresh':True,
                       'waiting_world_change':False,'unknown':0,'human':10,'owned':0}}

def request(op='set_fixed_count',count=20):
    r={'op':op,'operationId':'c'*32,'expectedEpoch':EPOCH,'expectedVersion':VERSION}
    if op=='set_fixed_count':r['count']=count
    return r

class AgentTests(unittest.TestCase):
    def test_generated_name_capacity_and_server_reserve_limit(self):
        self.assertEqual(agent.fixed_count_limit(snapshot()),99)
        for capacity,count,limit in ((80,80,79),(12,12,11)):
            value=snapshot();value['config']['capacity']=capacity
            with patch.object(agent,'broker',return_value=value) as rpc,patch.object(agent,'native_binding',return_value='d'*64),patch.object(agent,'fixed_verified',return_value=True):
                with self.assertRaises(agent.Refused) as caught:agent.handle(request(count=count))
                self.assertEqual(caught.exception.status,400)
                self.assertIn(str(limit),caught.exception.message)
                self.assertEqual(rpc.call_count,1)
    def test_expired_admission_does_not_block_durable_target_or_claim_native_ready(self):
        value=snapshot();value['available']=False;value['runtime']['admission_fresh']=False
        reply={'operation_id':'c'*32,'accepted':True,'applied':False,'outcome':'accepted','reason':'waiting'}
        with patch.object(agent,'broker',side_effect=[value,reply]) as rpc, patch.object(agent,'native_binding',return_value='d'*64), patch.object(agent,'fixed_verified',return_value=True):
            result=agent.handle(request(count=25))
            self.assertTrue(result['accepted']);self.assertFalse(result['applied'])
            self.assertEqual(rpc.call_args_list[-1].args[0]['target'],25)
        with patch.object(agent,'broker',return_value=value),patch.object(agent,'native_binding',return_value='d'*64),patch.object(agent,'fixed_verified',return_value=True):
            status=agent.status()
            self.assertTrue(status['capabilities']['configureFixedCount'])
            self.assertFalse(status['status']['available'])
            self.assertFalse(status['status']['runtime']['admission_fresh'])

    def test_unhealthy_or_changing_world_cannot_submit_new_target(self):
        for key,value in [('gt_fresh',False),('failed',True),('armed',False),('waiting_world_change',True)]:
            state=snapshot();state['runtime'][key]=value
            with patch.object(agent,'broker',return_value=state) as rpc,patch.object(agent,'native_binding',return_value='d'*64),patch.object(agent,'fixed_verified',return_value=True):
                with self.assertRaises(agent.Refused):agent.handle(request(count=25))
                self.assertEqual(rpc.call_count,1)

    def test_unavailable_scan_only_commits_intent_and_does_not_claim_applied(self):
        value=snapshot();value['available']=False
        value['runtime']['census_fresh']=False
        reply={'operation_id':'c'*32,'accepted':True,'applied':False,'outcome':'accepted','reason':'waiting'}
        with patch.object(agent,'broker',side_effect=[value,reply]) as rpc, patch.object(agent,'native_binding',return_value='d'*64), patch.object(agent,'fixed_verified',return_value=True):
            result=agent.handle(request(count=10))
            self.assertTrue(result['accepted']);self.assertFalse(result['applied'])
            self.assertEqual(rpc.call_count,2)

    def test_original_refuses_fixed_without_mutation(self):
        with patch.object(agent,'broker',return_value=snapshot()) as rpc, patch.object(agent,'native_binding',return_value=agent.ORIGINAL):
            with self.assertRaises(agent.Refused):agent.handle(request())
            self.assertEqual(rpc.call_args_list[0].args[0],{'op':'population_status'})
            self.assertEqual(rpc.call_count,1)

    def test_incomplete_candidate_cannot_be_profile_enabled(self):
        for digest in (agent.CANDIDATE,agent.ORIGINAL,None):
            self.assertFalse(agent.fixed_verified(digest))

    def test_fixed_only_verification_never_claims_queue_verified(self):
        digest='d'*64
        profile={'schema':2,'library_sha256':digest,'mode':'fixed_owned',
                 'full_policy':'preserve_owned_queue_humans','fixed_count_verified':True,
                 'publisher_verified':True,'queue_verified':False}
        fake=SimpleNamespace(lstat=lambda:SimpleNamespace(st_mode=stat.S_IFREG|0o600,st_uid=0,st_size=400),
                             read_bytes=lambda:agent.json.dumps(profile).encode())
        with patch.object(agent,'PROFILE',fake),patch.object(agent,'broker',return_value=snapshot()),patch.object(agent,'native_binding',return_value=digest):
            s=agent.status()
            self.assertTrue(s['capabilities']['fixedOwned'])
            self.assertFalse(s['capabilities']['queueVerified'])
            self.assertIn('尚未实测',s['message'])

    def test_verified_fixed_passes_count_not_humans_plus_count(self):
        reply={'operation_id':'c'*32,'accepted':True,'applied':False,'outcome':'accepted','reason':'waiting'}
        with patch.object(agent,'broker',side_effect=[snapshot(),reply]) as rpc, patch.object(agent,'native_binding',return_value='d'*64), patch.object(agent,'fixed_verified',return_value=True):
            result=agent.handle(request(count=20))
            self.assertEqual(rpc.call_args_list[-1].args[0]['target'],20)
            self.assertTrue(result['accepted']);self.assertFalse(result['applied'])

    def test_pause_supported_for_original(self):
        reply={'operation_id':'c'*32,'accepted':True,'applied':True,'outcome':'applied'}
        with patch.object(agent,'broker',side_effect=[snapshot(),reply]) as rpc, patch.object(agent,'native_binding',return_value=agent.ORIGINAL):
            agent.handle(request('pause'))
            mutation=rpc.call_args_list[-1].args[0]
            self.assertEqual(mutation['target'],0);self.assertIs(mutation['enabled'],False)

    def test_stale_epoch_does_not_submit(self):
        value=request('pause');value['expectedEpoch']='f'*64
        with patch.object(agent,'broker',return_value=snapshot()) as rpc, patch.object(agent,'native_binding',return_value=agent.ORIGINAL):
            with self.assertRaises(agent.Refused):agent.handle(value)
            self.assertEqual(rpc.call_count,1)

    def test_extra_paths_and_boolean_counts_rejected(self):
        for r in (dict(request(),path='/tmp/a'),request(count=True),request(count=100)):
            with patch.object(agent,'broker') as rpc:
                with self.assertRaises(agent.Refused):agent.handle(r)
                rpc.assert_not_called()

    def test_expired_status_not_used(self):
        value=snapshot();value['observed_at']-=30
        with patch.object(agent,'broker',return_value=value):
            with self.assertRaises(agent.Refused):agent.status()

    def test_mutation_failure_keeps_unknown_outcome(self):
        with patch.object(agent.subprocess,'run',side_effect=TimeoutError()):
            with self.assertRaises(agent.Refused) as caught:agent.broker({'op':'population_set'})
            self.assertEqual(caught.exception.outcome,'unknown')

    def test_prepare_start_is_pinned_and_confirms_zero(self):
        profile={'library_sha256':'d'*64,'startup_broker':'population_broker_fixed_owned_db929d72.py','startup_broker_sha256':'e'*64}
        fake=SimpleNamespace(lstat=lambda:SimpleNamespace(st_mode=stat.S_IFREG|0o600,st_uid=0,st_size=400),read_bytes=lambda:agent.json.dumps(profile).encode())
        result=SimpleNamespace(stdout=agent.json.dumps({'prepared':True,'paused':True,'target':0}))
        with patch.object(agent,'PROFILE',fake),patch.object(agent,'fixed_verified',return_value=True),patch.object(agent,'file_digest',return_value=('e'*64,None)),patch.object(agent.subprocess,'run',return_value=result) as run:
            self.assertEqual(agent.handle({'op':'prepare_start'})['target'],0)
            self.assertEqual(run.call_args.args[0][-1],'prepare-start')
            self.assertNotIn('shell',run.call_args.kwargs)

    def test_prepare_start_rejects_arbitrary_extra_paths(self):
        with patch.object(agent.subprocess,'run') as run:
            with self.assertRaises(agent.Refused):agent.handle({'op':'prepare_start','path':'/tmp/arbitrary'})
            run.assert_not_called()

    def test_prepare_start_failure_is_not_success(self):
        with patch.object(agent,'PROFILE') as profile:
            profile.lstat.side_effect=OSError()
            with self.assertRaises(agent.Refused):agent.prepare_game_start()

if __name__=='__main__':unittest.main()
